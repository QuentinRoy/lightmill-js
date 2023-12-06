/* eslint-disable @typescript-eslint/no-namespace */
import express from 'express';
import { zodiosContext } from '@zodios/express';
import { LogFilter, RunId, RunStatus, Store, StoreError } from './store.js';
import session from 'cookie-session';
import { NextFunction, Request, RequestHandler, Response } from 'express';
import { api } from '@lightmill/log-api';
import { csvExportStream, jsonExportStream } from './export.js';
import { pipeline } from 'stream/promises';
import log from 'loglevel';
import z from 'zod';
import { createId } from '@paralleldrive/cuid2';

const ctx = zodiosContext(
  z.object({
    session: z.union([
      z.null(),
      z
        .object({
          role: z.union([z.literal('host'), z.literal('participant')]),
          runs: z.array(RunId),
        })
        .strict(),
    ]),
  }),
);

type CreateLogServerOptions = {
  store: Store;
  secret: string;
  hostPassword?: string | undefined;
  allowCrossOrigin?: boolean | undefined;
  secureCookies?: boolean | undefined;
};
export function LogServer({
  store,
  secret,
  hostPassword,
  allowCrossOrigin = true,
  secureCookies = allowCrossOrigin,
}: CreateLogServerOptions): RequestHandler {
  if (secret == null) {
    throw new Error('Cannot create log server: secret parameter is required');
  }
  if (store == null) {
    throw new Error('Cannot create log server: store parameter is required');
  }

  let app = express();
  const router = ctx.app(api, { express: app });

  router.use(
    session({
      secret,
      sameSite: allowCrossOrigin ? 'none' : 'strict',
      secure: secureCookies,
      httpOnly: true,
    }),
  );

  router.put('/sessions/current', (req, res) => {
    if (req.session?.role != null) {
      res
        .status(400)
        .json({ status: 'error', message: 'Client already has a session' });
      return;
    }
    const { role, password } = req.body;
    if (role === 'host' && hostPassword != null && password !== hostPassword) {
      res
        .status(403)
        .json({ status: 'error', message: `Forbidden role: ${role}` });
    }
    req.session = { role, runs: [] };
    res.status(201).json({ status: 'ok', role, runs: [] });
  });

  router.get('/sessions/current', async (req, res) => {
    if (!req.session?.isPopulated) {
      res.status(404).json({ status: 'error', message: 'No session found' });
      return;
    }
    res.status(200).json({
      status: 'ok',
      role: req.session.role,
      runs: (await store.getRuns({ runId: req.session.runs })).map(
        ({ runId, ...r }) => r,
      ),
    });
  });

  router.delete('/sessions/current', (req, res) => {
    if (req.session?.role == null) {
      res.status(404).json({ status: 'error', message: 'No session found' });
      return;
    }
    req.session = null;
    res.status(200).json({ status: 'ok' });
  });

  router.post('/runs', async (req, res, next) => {
    try {
      if (req.session?.role == null) {
        req.session = { role: 'participant', runs: [] };
      }
      if (req.session.runs.length > 0) {
        const clientRuns = await store.getRuns({ runId: req.session.runs });
        if (
          clientRuns.some(
            (r) => r?.runStatus === 'running' || r?.runStatus === 'interrupted',
          )
        ) {
          res.status(403).json({
            status: 'error',
            message: 'Client already has started runs, end them first',
          });
          return;
        }
      }
      const run = {
        runStatus: req.body?.runStatus,
        experimentName: req.body?.experimentName ?? 'default',
        runName: req.body?.runName ?? createId(),
      };
      const { runId, runStatus, runName, experimentName } =
        await store.addRun(run);
      req.session.runs.push(runId);
      res
        .status(201)
        .json({ status: 'ok', runName, experimentName, runStatus });
    } catch (e) {
      if (e instanceof StoreError && e.code === 'RUN_EXISTS') {
        res.status(403).json({ status: 'error', message: e.message });
        return;
      }
      next(e);
    }
  });

  router.get(
    '/experiments/:experimentName/runs/:runName',
    async (req, res, next) => {
      try {
        let { experimentName, runName } = req.params;
        experimentName = String(experimentName);
        runName = String(runName);
        let matchingSessionRuns =
          req.session?.runs == null || req.session.runs.length === 0
            ? []
            : await store.getRuns({
                runName,
                experimentName,
                runId: req.session.runs,
              });
        if (matchingSessionRuns.length === 0) {
          res.status(403).json({
            status: 'error',
            message: `Client does not have permission to access run "${runName}" of experiment "${experimentName}"`,
          });
          return;
        }
        let lastRun = matchingSessionRuns[matchingSessionRuns.length - 1];
        let logSummary = await store.getLogSummary(lastRun.runId);
        res.status(200).json({
          status: 'ok',
          run: {
            runName: lastRun.runName,
            runStatus: lastRun.runStatus,
            experimentName: lastRun.experimentName,
            logs: logSummary,
          },
        });
      } catch (e) {
        next(e);
      }
    },
  );

  const allowedStatusTransitions = [
    { from: 'interrupted', to: 'running' },
    { from: 'interrupted', to: 'canceled' },
    { from: 'running', to: 'interrupted' },
    { from: 'running', to: 'canceled' },
    { from: 'running', to: 'completed' },
    // This is only allowed if the run is resumed from a specific log number.
    { from: 'running', to: 'running' },
    { from: 'idle', to: 'running' },
    { from: 'idle', to: 'canceled' },
    { from: 'idle', to: 'interrupted' },
  ] as const satisfies Array<{ from: RunStatus; to: RunStatus }>;
  router.patch(
    '/experiments/:experimentName/runs/:runName',
    async (req, res) => {
      let { experimentName, runName } = req.params;
      experimentName = String(experimentName);
      runName = String(runName);
      let sessionRuns =
        req.session?.runs == null || req.session.runs.length === 0
          ? []
          : await store.getRuns({ runId: req.session.runs });
      let matchingSessionRuns = sessionRuns.filter(
        (r) => r.experimentName === experimentName && r.runName === runName,
      );
      if (matchingSessionRuns.length === 0) {
        res.status(403).json({
          status: 'error',
          message: `Client does not have permission to access run "${runName}" of experiment "${experimentName}"`,
        });
        return;
      }
      let targetRun = matchingSessionRuns[sessionRuns.length - 1];

      const oldRunStatus = targetRun.runStatus;
      const newRunStatus = req.body.runStatus;

      if (
        !allowedStatusTransitions.some(
          (t) => t.from === oldRunStatus && t.to === newRunStatus,
        )
      ) {
        res.status(400).json({
          status: 'error',
          message: `Cannot transition from ${oldRunStatus} to ${newRunStatus}`,
        });
        return;
      }

      if (
        newRunStatus !== 'canceled' &&
        sessionRuns.some((r) => r !== targetRun && r.runStatus !== 'canceled')
      ) {
        res.status(403).json({
          status: 'error',
          message: 'Client already has other ongoing runs, end them first',
        });
        return;
      }

      // Case: resume run, target run status should necessarily be 'running'.
      if ('resumeFrom' in req.body && req.body.resumeFrom != null) {
        const logSummary = await store.getLogSummary(targetRun.runId);
        let logCount = Math.max(...logSummary.map((l) => l.lastNumber));
        if (logCount < req.body.resumeFrom) {
          res.status(400).json({
            status: 'error',
            message: `Cannot resume from ${req.body.resumeFrom}, run has only ${logCount} logs`,
          });
          return;
        }
        await store.resumeRun(targetRun.runId, { from: req.body.resumeFrom });
      } else if (newRunStatus === oldRunStatus) {
        res.status(403).json({
          status: 'error',
          message: `Run is already ${newRunStatus}`,
        });
        return;
      } else {
        // Case: update status.
        await store.setRunStatus(targetRun.runId, req.body.runStatus);
      }
      res.status(200).json({ status: 'ok' });
    },
  );

  router.post(
    '/experiments/:experimentName/runs/:runName/logs',
    async (req, res, next) => {
      let { experimentName, runName } = req.params;
      experimentName = String(experimentName);
      runName = String(runName);
      let matchingSessionRuns =
        req.session?.runs == null || req.session.runs.length === 0
          ? []
          : await store.getRuns({
              runName,
              experimentName,
              runId: req.session.runs,
            });
      if (matchingSessionRuns.length === 0) {
        res.status(403).json({
          status: 'error',
          message: `Client does not have permission to access run "${runName}" of experiment "${experimentName}"`,
        });
        return;
      }
      let lastRun = matchingSessionRuns[matchingSessionRuns.length - 1];
      try {
        if (lastRun.runStatus != 'running') {
          // This should not happen either because a client should lose
          // access to the run once it is ended.
          res.status(403).json({
            status: 'error',
            message: `Cannot add logs to run, run is ${lastRun.runStatus}`,
          });
          return;
        }
        let logs = 'logs' in req.body ? req.body.logs : [req.body.log];
        await store.addLogs(lastRun.runId, logs);
        res.status(201).json({ status: 'ok' });
      } catch (e) {
        if (
          e instanceof StoreError &&
          e.code === 'LOG_NUMBER_EXISTS_IN_SEQUENCE'
        ) {
          res.status(403).json({ status: 'error', message: e.message });
          return;
        }
        next(e);
      }
    },
  );

  router.get('/experiments/:experimentName/logs', async (req, res, next) => {
    try {
      if (req.session?.role !== 'host') {
        res
          .status(403)
          .json({ status: 'error', message: 'Access restricted.' });
        return;
      }
      let format = 'json';
      let acceptHeader = req.header('Accept');
      if (acceptHeader != null) {
        for (let accept of acceptHeader.split(',')) {
          if (accept.includes('csv')) {
            format = 'csv';
            break;
          } else if (accept.includes('json')) {
            format = 'json';
            break;
          }
        }
      }
      let filter: LogFilter = {
        experimentName: String(req.params.experimentName),
        type: req.query.type,
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
    res.status(404).json({ status: 'error', message: 'Not found' });
  });

  app.use((error: unknown, req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      next(error);
    } else if (error instanceof Error) {
      res.status(500).json({ status: 'error', message: error.message });
    } else {
      log.error('error', error);
      next(error);
    }
  });

  return app;
}
