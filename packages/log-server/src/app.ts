/* eslint-disable @typescript-eslint/no-namespace */
import express from 'express';
import { zodiosContext } from '@zodios/express';
import { LogFilter, Store } from './store.js';
import session from 'cookie-session';
import dotenv from 'dotenv';
import { SqliteError } from 'better-sqlite3';
import { NextFunction, Request, RequestHandler, Response } from 'express';
import { api } from './api.js';
import { csvExportStream, jsonExportStream } from './export.js';
import { pipeline } from 'stream/promises';
import log from 'loglevel';
import z from 'zod';
import cuid from 'cuid';

dotenv.config();

const ctx = zodiosContext(
  z.object({
    session: z.union([
      z.null(),
      z
        .object({
          role: z.union([z.literal('admin'), z.literal('participant')]),
          runs: z.array(
            z.object({
              runId: z.string(),
              experimentId: z.string(),
            })
          ),
        })
        .strict(),
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
    req.session = { role, runs: [] };
    res.status(200).json({ status: 'ok', role, runs: [] });
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
      runs: req.session.runs.map((r) => ({
        id: r.runId,
        experiment: r.experimentId,
      })),
    });
  });

  router.delete('/sessions/current', (req, res) => {
    if (req.session?.role == null) {
      res.status(404).json({
        status: 'error',
        message: 'No session found',
      });
      return;
    }
    req.session = null;
    res.status(200).json({ status: 'ok' });
  });

  router.post('/experiments/runs', async (req, res, next) => {
    try {
      if (req.session?.role == null) {
        req.session = { role: 'participant', runs: [] };
      }
      if (req.session.runId != null) {
        res.status(403).json({
          status: 'error',
          message: 'Client already has a started run, end it first',
        });
        return;
      }
      let runId = req.body?.id ?? cuid();
      let experimentId = req.body?.experiment ?? 'default';
      const run = {
        ...req.body,
        experimentId,
        runId,
        createdAt: new Date(),
      };
      await store.addRun(run);
      req.session.runs.push({ runId, experimentId });
      res.status(200).json({
        status: 'ok',
        run: runId,
        experiment: experimentId,
        links: {
          logs: `/experiments/${experimentId}/runs/${runId}/logs`,
          run: `/experiments/${experimentId}/runs/${runId}`,
        },
      });
    } catch (e) {
      if (e instanceof SqliteError && e.code === 'SQLITE_CONSTRAINT') {
        res.status(400).json({
          status: 'error',
          message:
            'Could not add run, probably because a run with that ID already exists for this experiment',
        });
        return;
      }
      next(e);
    }
  });

  router.put('/experiments/:experiment/runs/:run', async (req, res, next) => {
    let { experiment: experimentId, run: runId } = req.params;
    experimentId = String(experimentId);
    runId = String(runId);
    try {
      if (
        req.session?.runs?.find(
          (r) => r.runId === runId && r.experimentId === experimentId
        ) == null
      ) {
        res.status(403).json({
          status: 'error',
          message: `Client does not have permission to update run "${runId}" of experiment "${experimentId}"`,
        });
        return;
      }
      let run = await store.getRun(experimentId, runId);
      if (run == null) {
        throw new Error(`Session run not found: ${runId}`);
      }

      // At the moment, the only supported put operation is
      // { "status": "completed" | "canceled" }, so there is nothing more to
      // check here, zodios does it for us already.
      if (run.status != 'running') {
        res.status(400).json({
          status: 'error',
          message: 'Run already ended',
        });
        return;
      }
      await store.setRunStatus(experimentId, runId, req.body.status);
      req.session.runs = req.session.runs.filter(
        (r) => r.runId !== runId && r.experimentId !== experimentId
      );
      res.status(200).json({ status: 'ok' });
    } catch (e) {
      next(e);
    }
  });

  router.post(
    '/experiments/:experiment/runs/:run/logs',
    async (req, res, next) => {
      let { experiment: experimentId, run: runId } = req.params;
      experimentId = String(experimentId);
      runId = String(runId);
      try {
        if (
          req.session?.runs?.find(
            (r) => r.runId === runId && r.experimentId === experimentId
          ) == null
        ) {
          res.status(403).json({
            status: 'error',
            message: `Client does not have permission to post logs for run "${runId}" of experiment "${experimentId}"`,
          });
          return;
        }
        let sessionRun = await store.getRun(experimentId, runId);
        if (sessionRun == null) {
          // This should not happen in normal use, except if the database is
          // corrupted, or removed.
          throw new Error(`Session run not found: ${runId}`);
        }
        if (sessionRun.status != 'running') {
          res.status(403).json({
            status: 'error',
            message: 'Cannot add logs to an ended run',
          });
          return;
        }
        let logs = 'logs' in req.body ? req.body.logs : [req.body.log];
        await store.addRunLogs(experimentId, runId, logs);
        res.status(200).json({ status: 'ok' });
      } catch (e) {
        next(e);
      }
    }
  );

  router.get('/experiments/:experiment/runs/logs', async (req, res, next) => {
    try {
      if (req.session?.role !== 'admin') {
        res.status(403).json({
          status: 'error',
          message: 'Access restricted.',
        });
        return;
      }
      let { format, type } = req.query;
      let { experiment } = req.params ?? {};
      let filter: LogFilter = {
        experiment: experiment == null ? undefined : String(experiment),
        type: type,
      };
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
