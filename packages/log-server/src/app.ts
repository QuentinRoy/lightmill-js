/* eslint-disable @typescript-eslint/no-namespace */
import { Store } from './store.js';
import session from 'cookie-session';
import dotenv from 'dotenv';
import { SqliteError } from 'better-sqlite3';
import {
  NextFunction,
  Request,
  RequestHandler,
  Response,
  Router,
} from 'express';
import bodyParser from 'body-parser';
import * as api from './api.js';
import {
  formatErrorMiddleware as formatValidationError,
  parseRequestBody,
  parseRequestQuery,
  ValidationError,
} from './validate.js';
import cuid from 'cuid';
import { csvExportStream, jsonExportStream } from './export.js';
import { pipeline } from 'stream/promises';
import log from 'loglevel';

dotenv.config();

declare global {
  namespace CookieSessionInterfaces {
    interface CookieSessionObject {
      // Sometimes, this will be an empty object, so every properties have to be
      // optional.
      role?: 'admin' | 'participant';
      runId?: string;
    }
  }
  namespace Express {
    interface Request {
      store: Store;
    }
  }
}

type CreateAppParams = {
  store: Store;
  secret: string;
  adminPassword?: string;
};
export function createLogServer({
  store,
  secret,
}: CreateAppParams): RequestHandler {
  const router = Router();

  router.use((req, res, next) => {
    req.store = store;
    next();
  });

  router.use(bodyParser.json());

  router.use(session({ secret }));

  router.post('/sessions', (req, res) => {
    if (req.session?.role != null) {
      res.status(400).json({
        status: 'error',
        message: 'Client already has a session',
      } satisfies api.ErrorAnswer);
      return;
    }
    const { role, password } = parseRequestBody(api.PostSessionBody, req);
    if (role === 'admin' && password !== process.env.ADMIN_PASSWORD) {
      res.status(403).json({
        status: 'error',
        message: `Forbidden role: ${role}`,
      } satisfies api.ErrorAnswer);
    }
    req.session = { role };
    res.status(200).json({ status: 'ok', role } satisfies api.PutSessionAnswer);
  });

  router.get('/sessions/current', (req, res) => {
    if (req.session?.role == null) {
      res.status(404).json({
        status: 'error',
        message: 'No session found',
      } satisfies api.ErrorAnswer);
      return;
    }
    res.status(200).json({
      status: 'ok',
      session: {
        role: req.session.role,
        runId: req.session.runId,
      },
    } satisfies api.GetSessionAnswer);
  });

  router.delete('/sessions/current', (req, res) => {
    if (req.session?.role == null) {
      res.status(404).json({
        status: 'error',
        message: 'No session found',
      } satisfies api.ErrorAnswer);
      return;
    } else if (req.session.runId != null) {
      res.status(403).json({
        status: 'error',
        message: 'End run first',
      } satisfies api.ErrorAnswer);
      return;
    }
    req.session = null;
    res.status(200).json({ status: 'ok' } satisfies api.DeleteSessionAnswer);
  });

  router.post('/runs', async (req, res, next) => {
    try {
      if (req.session?.role == null) {
        res.status(403).json({
          status: 'error',
          message: 'Session required to create a run',
        } satisfies api.ErrorAnswer);
        return;
      }
      if (req.session.runId != null) {
        res.status(403).json({
          status: 'error',
          message: 'Client already has a started run, end it first',
        } satisfies api.ErrorAnswer);
        return;
      }
      const params = parseRequestBody(api.PostRunsBody, req);
      const run = {
        ...params,
        id: params.id ?? cuid(),
        createdAt: new Date(),
      };
      await store.addRun(run);
      req.session.runId = run.id;
      res
        .status(200)
        .json({ status: 'ok', id: run.id } satisfies api.PostRunsAnswer);
    } catch (e) {
      if (e instanceof SqliteError && e.code === 'SQLITE_CONSTRAINT') {
        res.status(400).json({
          status: 'error',
          message:
            'Could not add run, probably because a run with that ID already exists',
        } satisfies api.ErrorAnswer);
        return;
      }
      next(e);
    }
  });

  router.put('/runs/:id', async (req, res, next) => {
    let runId = req.params.id;
    try {
      if (req.session?.role == null || req.session.runId != runId) {
        res.status(403).json({
          status: 'error',
          message: `Client does not have permission run ${runId}`,
        } satisfies api.ErrorAnswer);
        return;
      }
      const params = parseRequestBody(api.PutRunsBody, req);
      let run = await store.getRun(runId);
      if (run == null) {
        res.status(404).json({
          status: 'error',
          message: `Run ${runId} does not exist`,
        } satisfies api.ErrorAnswer);
        return;
      }
      if (!params.ended && run.endedAt != null) {
        res.status(400).json({
          status: 'error',
          message: 'Cannot restart an ended run',
        } satisfies api.ErrorAnswer);
        return;
      }
      if (!params.ended && run.endedAt == null) {
        res.status(400).json({
          status: 'error',
          message: 'Run has not ended, and cannot restart an ended run anyway',
        } satisfies api.ErrorAnswer);
        return;
      }
      if (params.ended && run.endedAt != null) {
        res.status(400).json({
          status: 'error',
          message: 'Run already ended',
        } satisfies api.ErrorAnswer);
        return;
      }
      await store.endRun(runId);
      req.session.runId = undefined;
      res.status(200).json({ status: 'ok' } satisfies api.PutRunsAnswer);
    } catch (e) {
      next(e);
    }
  });

  router.post('/logs', async (req, res, next) => {
    try {
      if (req.session?.runId == null) {
        res.status(403).json({
          status: 'error',
          message: 'Client does not have a run',
        } satisfies api.ErrorAnswer);
        return;
      }
      let params = parseRequestBody(api.PostLogsBody, req);
      let runId = params.runId;
      if (runId != req.session?.runId) {
        res.status(403).json({
          status: 'error',
          message: `Client does not have permission run ${runId}`,
        } satisfies api.ErrorAnswer);
        return;
      }
      let sessionRun = await store.getRun(runId);
      if (sessionRun == null) {
        throw new Error(`Session run not found: ${runId}`);
      }
      if (sessionRun.endedAt != null) {
        res.status(403).json({
          status: 'error',
          message: 'Cannot add logs to an ended run',
        } satisfies api.ErrorAnswer);
        return;
      }
      let logs = 'logs' in params ? params.logs : [params.log];
      await store.addLogs(logs.map((l) => ({ ...l, runId })));
      res.status(200).json({ status: 'ok' } satisfies api.PostLogsAnswer);
    } catch (e) {
      next(e);
    }
  });

  router.get('/logs', async (req, res, next) => {
    try {
      let { format, ...filter } = parseRequestQuery(api.GetLogsParams, req);

      // Only admins can access this endpoint without runId.
      // TODO: Add an admin login endpoint.
      if (req.session?.role !== 'admin' && filter.runId == null) {
        res.status(403).json({
          status: 'error',
          message: 'Only admins can access logs from all runs',
        } satisfies api.ErrorAnswer);
        return;
      } else if (
        req.session?.role !== 'admin' &&
        filter.runId != req.session?.runId
      ) {
        res.status(403).json({
          status: 'error',
          message: `Client does not have permission run ${filter.runId}`,
        } satisfies api.ErrorAnswer);
        return;
      }
      if (format === 'csv') {
        res.setHeader('Content-Type', 'text/csv');
        await pipeline(csvExportStream(store, filter), res);
      } else {
        res.setHeader('Content-Type', 'application/json');
        await pipeline(jsonExportStream(store, filter), res);
      }
    } catch (e) {
      next(e);
    }
  });

  router.use(
    formatValidationError((error) => {
      return {
        status: 'error',
        message: 'Invalid request body',
        issues: error.issues,
      };
    })
  );

  router.use('*', (req, res) => {
    res.status(404).json({
      status: 'error',
      message: 'Not found',
    } satisfies api.ErrorAnswer);
  });

  router.use(
    (error: Error, req: Request, res: Response, next: NextFunction) => {
      if (res.headersSent) {
        next(error);
      } else if (error instanceof ValidationError) {
        res.status(400).json({
          status: 'error',
          message: 'Invalid request body',
          issues: error.issues,
        });
      } else if (error instanceof Error) {
        res.status(500).json({
          status: 'error',
          message: error.message,
        } satisfies api.ErrorAnswer);
      } else {
        log.error('error', error);
        next(error);
      }
    }
  );

  return router;
}
