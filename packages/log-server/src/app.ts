import koa, { Context } from 'koa';
import Router from '@koa/router';
import session from 'koa-generic-session';
import bodyParser from 'koa-bodyparser';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import dotenv from 'dotenv';
import {
  formatErrorMiddleware as formatValidationError,
  parseRequestBody,
  parseRequestQuery,
} from './validate.js';
import { Store } from './store.js';
import { SessionStoreAdapter } from './session-store-adapter.js';
import { csvExportStream, jsonExportStream } from './export.js';
import { arrayify } from './utils.js';
import * as api from './api.js';
import cuid from 'cuid';

// Configure environment variables and types.
// -----------------------------------------------------------------------------

dotenv.config();

declare module 'koa-generic-session' {
  interface Session {
    // These properties are not direct session property otherwise its type
    // might not be respected. koa-generic-session will always create a session
    // object containing the cookie property only when the session hasn't been
    // initialized yet.
    logging?: {
      role: 'admin' | 'participant';
      runId?: string;
    };
  }
}

const env = z.object({ SECRET: z.string().optional() }).parse(process.env);

// Define the application.
// -----------------------------------------------------------------------------

type CreateAppParams = {
  store: Store;
  secret?: string;
};
export function createApp({
  store,
  secret = env.SECRET ?? randomBytes(64).toString('hex'),
}: CreateAppParams) {
  const app = new koa<never, Context>();

  const router = new Router<never, Context>();
  router.use(bodyParser());
  router.use(
    session({
      store: new SessionStoreAdapter(store),
      cookie: {
        path: '/',
        httpOnly: true,
        maxAge: 1000 * 60 * 60 * 24,
        signed: true,
      },
    })
  );
  router.use(
    formatValidationError((error) => {
      return {
        status: 'error',
        message: 'Invalid request body',
        issues: error.issues,
      };
    })
  );

  router.post('/sessions', async (ctx) => {
    if (ctx.session == null) throw new Error('Session not initialized');
    const { role } = parseRequestBody(api.PutSessionBody, ctx);
    if (role !== 'participant') {
      ctx.status = 403;
      ctx.body = {
        status: 'error',
        message: `Forbidden role: ${role}`,
      } satisfies api.ErrorAnswer;
    }
    ctx.session.logging = { role };
    ctx.status = 200;
    ctx.body = { status: 'ok', role } satisfies api.PutSessionAnswer;
  });

  router.get('/sessions/current', async (ctx) => {
    if (ctx.session?.logging == null) {
      ctx.status = 404;
      ctx.body = {
        status: 'error',
        message: 'Client does not have a session',
      } satisfies api.ErrorAnswer;
      return;
    }
    ctx.status = 200;
    ctx.body = {
      status: 'ok',
      session: {
        runId: ctx.session.logging?.runId,
        role: ctx.session.logging.role,
      },
    } satisfies api.GetSessionAnswer;
  });

  router.delete('/sessions/current', async (ctx) => {
    if (ctx.session?.logging == null) {
      ctx.status = 404;
      ctx.body = {
        status: 'error',
        message: 'Client does not have a session',
      } satisfies api.ErrorAnswer;
      return;
    }
    ctx.session = null;
    ctx.status = 200;
    ctx.body = { status: 'ok' } satisfies api.DeleteSessionAnswer;
  });

  router.post('/runs', async (ctx) => {
    if (ctx.session?.logging == null) {
      ctx.status = 403;
      ctx.body = {
        status: 'error',
        message: 'Client does not have a session',
      } satisfies api.ErrorAnswer;
      return;
    }
    if (ctx.session.logging.runId != null) {
      ctx.status = 403;
      ctx.body = {
        status: 'error',
        message: 'Client already has a started run, end it first',
      } satisfies api.ErrorAnswer;
      return;
    }
    let reqBody = parseRequestBody(api.PostRunsBody, ctx);
    let run = { ...reqBody, id: reqBody.id ?? cuid(), createdAt: new Date() };
    let runId = await store.addRun(run);
    ctx.session.logging.runId = runId;
    ctx.body = { status: 'ok', id: runId } satisfies api.PostRunsAnswer;
    ctx.status = 200;
  });

  router.put('/runs/:id', async (ctx) => {
    let runId = ctx.params.id;
    if (
      ctx.session?.logging?.runId == null ||
      ctx.session.logging.runId !== runId
    ) {
      ctx.status = 403;
      ctx.body = {
        status: 'error',
        message: `Client does not have permission run ${runId}`,
      } satisfies api.ErrorAnswer;
      return;
    }
    let params = parseRequestBody(api.PutRunsBody, ctx);
    let run = await store.getRun(runId);
    if (run == null) {
      throw new Error(`Session run not found: ${runId}`);
    }
    if (!params.ended && run.endedAt != null) {
      ctx.body = {
        status: 'error',
        message: 'Cannot restart an ended run',
      } satisfies api.ErrorAnswer;
      ctx.status = 400;
      return;
    }
    if (!params.ended && run.endedAt == null) {
      ctx.body = {
        status: 'error',
        message: 'Run has not ended, and cannot restart an ended run anyway',
      } satisfies api.ErrorAnswer;
      ctx.status = 400;
      return;
    }
    if (params.ended && run.endedAt != null) {
      ctx.body = {
        status: 'error',
        message: 'Run already ended',
      } satisfies api.ErrorAnswer;
      ctx.status = 400;
      return;
    }
    await store.endRun(runId);
    ctx.session.logging.runId = undefined;
    ctx.body = { status: 'ok' } satisfies api.PutRunsAnswer;
    ctx.status = 200;
    return;
  });

  router.post('/logs', async (ctx) => {
    let sessionRunId = ctx.session?.logging?.runId;
    if (sessionRunId == null) {
      ctx.status = 403;
      ctx.body = {
        status: 'error',
        message: `Client is not associated with an ongoing run`,
      } satisfies api.ErrorAnswer;
      return;
    }
    let logs = arrayify(parseRequestBody(api.PostLogsBody, ctx));
    let unauthorizedRunIds = logs
      .filter((log) => log.runId !== sessionRunId)
      .map((log) => log.runId);
    if (unauthorizedRunIds.length > 0) {
      ctx.status = 403;
      ctx.body = {
        status: 'error',
        message: `Client does not have permission to add logs to run ${unauthorizedRunIds[0]}`,
      } satisfies api.ErrorAnswer;
      return;
    }
    let sessionRun = await store.getRun(sessionRunId);
    if (sessionRun == null) {
      throw new Error(`Session run not found: ${sessionRunId}`);
    }
    if (sessionRun.endedAt != null) {
      ctx.status = 403;
      ctx.body = {
        status: 'error',
        message: 'Cannot add logs to an ended run',
      } satisfies api.ErrorAnswer;
      return;
    }
    await store.addLogs(logs);
    ctx.body = { status: 'ok' } satisfies api.PostLogsAnswer;
    ctx.status = 200;
  });

  router.get('/logs', async (ctx) => {
    let { format, ...filter } = parseRequestQuery(api.GetLogsParams, ctx);
    // Only admins can access this endpoint without runId.
    // TODO: Add an admin login endpoint.
    if (ctx.session?.logging?.role !== 'admin' && filter.runId == null) {
      ctx.status = 403;
      ctx.body = {
        status: 'error',
        message: 'Only admins can access logs from all runs',
      } satisfies api.ErrorAnswer;
      return;
    } else if (
      ctx.session?.logging?.role !== 'admin' &&
      filter.runId != ctx.session?.logging?.runId
    ) {
      ctx.status = 403;
      ctx.body = {
        status: 'error',
        message: `Client does not have permission run ${filter.runId}`,
      } satisfies api.ErrorAnswer;
      return;
    }
    if (format === 'csv') {
      ctx.body = csvExportStream(store, filter);
      ctx.headers['content-type'] = 'text/csv';
    } else {
      ctx.body = jsonExportStream(store, filter);
      ctx.headers['content-type'] = 'application/json';
    }
    ctx.status = 200;
  });

  app.keys = [secret];
  app.use(router.routes());
  app.use(router.allowedMethods());
  return app;
}
