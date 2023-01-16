/* eslint-disable @typescript-eslint/no-namespace */
import express from 'express';
import { zodiosContext } from '@zodios/express';
import { Store } from './store.js';
import session from 'cookie-session';
import dotenv from 'dotenv';
import { SqliteError } from 'better-sqlite3';
import { NextFunction, Request, RequestHandler, Response } from 'express';
import { api } from './api.js';
import cuid from 'cuid';
import { csvExportStream, jsonExportStream } from './export.js';
import { pipeline } from 'stream/promises';
import log from 'loglevel';
import z from 'zod';

dotenv.config();

const ctx = zodiosContext(
  z.object({
    session: z.union([
      z.undefined(),
      z.null(),
      // Unfortunately this may happen after a session has been deleted.
      z.object({}),
      z.object({ role: z.string(), runId: z.string().optional() }),
    ]),
  })
);

type CreateAppParams = {
  store: Store;
  secret: string;
  adminPassword?: string;
};
export function createLogServer({
  store,
  secret,
}: CreateAppParams): RequestHandler {
  let app = express();
  const router = ctx.app(api, { express: app });

  router.use(session({ secret }));

  router.post('/sessions', (req, res) => {
    if (req.session?.role != null) {
      res.status(400).json({
        status: 'error',
        message: 'Client already has a session',
      });
      return;
    }
    const { role, password } = req.body;
    if (role === 'admin' && password !== process.env.ADMIN_PASSWORD) {
      res.status(403).json({
        status: 'error',
        message: `Forbidden role: ${role}`,
      });
    }
    req.session = { role };
    res.status(200).json({ status: 'ok', role });
  });

  router.get('/sessions/current', (req, res) => {
    if (req.session?.role == null) {
      res.status(404).json({
        status: 'error',
        message: 'No session found',
      });
      return;
    }
    res.status(200).json({
      status: 'ok',
      role: req.session.role,
      runId: req.session.runId,
    });
  });

  router.delete('/sessions/current', (req, res) => {
    if (req.session?.role == null) {
      res.status(404).json({
        status: 'error',
        message: 'No session found',
      });
      return;
    } else if (req.session.runId != null) {
      res.status(403).json({
        status: 'error',
        message: 'End run first',
      });
      return;
    }
    req.session = null;
    res.status(200).json({ status: 'ok' });
  });

  router.post('/runs', async (req, res, next) => {
    try {
      if (req.session?.role == null) {
        res.status(403).json({
          status: 'error',
          message: 'Session required to create a run',
        });
        return;
      }
      if (req.session.runId != null) {
        res.status(403).json({
          status: 'error',
          message: 'Client already has a started run, end it first',
        });
        return;
      }
      const run = {
        ...req.body,
        id: req.body.id ?? cuid(),
        createdAt: new Date(),
      };
      await store.addRun(run);
      req.session.runId = run.id;
      res.status(200).json({ status: 'ok', id: run.id });
    } catch (e) {
      if (e instanceof SqliteError && e.code === 'SQLITE_CONSTRAINT') {
        res.status(400).json({
          status: 'error',
          message:
            'Could not add run, probably because a run with that ID already exists',
        });
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
        });
        return;
      }
      let run = await store.getRun(runId);
      if (run == null) {
        res.status(404).json({
          status: 'error',
          message: `Run ${runId} does not exist`,
        });
        return;
      }
      if (!req.body.ended && run.endedAt != null) {
        res.status(400).json({
          status: 'error',
          message: 'Cannot restart an ended run',
        });
        return;
      }
      if (!req.body.ended && run.endedAt == null) {
        res.status(400).json({
          status: 'error',
          message: 'Run has not ended, and cannot restart an ended run anyway',
        });
        return;
      }
      if (req.body.ended && run.endedAt != null) {
        res.status(400).json({
          status: 'error',
          message: 'Run already ended',
        });
        return;
      }
      await store.endRun(runId);
      req.session.runId = undefined;
      res.status(200).json({ status: 'ok' });
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
        });
        return;
      }
      if (req.body.runId != req.session?.runId) {
        res.status(403).json({
          status: 'error',
          message: `Client does not have permission run ${req.body.runId}`,
        });
        return;
      }
      let sessionRun = await store.getRun(req.body.runId);
      if (sessionRun == null) {
        throw new Error(`Session run not found: ${req.body.runId}`);
      }
      if (sessionRun.endedAt != null) {
        res.status(403).json({
          status: 'error',
          message: 'Cannot add logs to an ended run',
        });
        return;
      }
      let logs = 'logs' in req.body ? req.body.logs : [req.body.log];
      await store.addLogs(logs.map((l) => ({ ...l, runId: req.body.runId })));
      res.status(200).json({ status: 'ok' });
    } catch (e) {
      next(e);
    }
  });

  router.get('/logs', async (req, res, next) => {
    try {
      let { format, ...filter } = req.query;

      // Only admins can access this endpoint without runId.
      // TODO: Add an admin login endpoint.
      if (req.session?.role !== 'admin' && filter.runId == null) {
        res.status(403).json({
          status: 'error',
          message: 'Only admins can access logs from all runs',
        });
        return;
      } else if (
        req.session?.role !== 'admin' &&
        filter.runId != req.session?.runId
      ) {
        res.status(403).json({
          status: 'error',
          message: `Client does not have permission run ${filter.runId}`,
        });
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

  router.use('*', (req, res) => {
    res.status(404).json({
      status: 'error',
      message: 'Not found',
    });
  });

  app.use((error: unknown, req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      next(error);
    } else if (error instanceof Error) {
      res.status(500).json({
        status: 'error',
        message: error.message,
      });
    } else {
      log.error('error', error);
      next(error);
    }
  });

  return app;
}
