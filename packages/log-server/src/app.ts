import koa from 'koa';
import Router from '@koa/router';
import bodyParser from 'koa-bodyparser';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import dotenv from 'dotenv';
import session from 'koa-generic-session';
import {
  formatErrorMiddleware as formatValidationError,
  parseRequestBody,
  parseRequestQuery,
} from './validate.js';
import { Store } from './store.js';
import { SessionStoreAdapter } from './session-store-adapter.js';
import { csvExportStream, jsonExportStream } from './export.js';

dotenv.config();

declare module 'koa-generic-session' {
  interface Session {
    createdAt: Date;
    expiresAt: Date | null;
    run: { id: string; createdAt: Date | null; endedAt: Date | null };
  }
}

const env = z.object({ SECRET: z.string().optional() }).parse(process.env);
const secret = env.SECRET ?? randomBytes(64).toString('hex');

// Declare a zod schema for JSON values.
const JsonLiteral = z.union([z.string(), z.number(), z.boolean(), z.null()]);
type JsonLiteral = z.infer<typeof JsonLiteral>;
type Json = JsonLiteral | { [key: string]: Json } | Json[];
const Json: z.ZodType<Json> = z.lazy(() =>
  z.union([JsonLiteral, z.array(Json), z.record(Json)])
);

export function createApp({ store }: { store: Store }) {
  const app = new koa();

  const router = new Router();
  router.use(bodyParser());
  router.use(
    session({
      store: new SessionStoreAdapter(store),
      cookie: {
        path: '/',
        httpOnly: true,
        maxAge: 1000 * 60 * 60 * 24,
        overwrite: true,
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

  const RunsParameter = z.object({
    id: z.string().optional(),
    experimentId: z.string().optional(),
  });
  router.post('/runs', async (ctx) => {
    let params = parseRequestBody(RunsParameter, ctx);
    let runId = await store.addRun(params);
    ctx.session.run = { ...params, id: runId };
    ctx.body = { id: runId };
    ctx.status = 200;
  });

  const PostLogsLogParameter = z.object({
    type: z.string(),
    values: z.record(Json),
  });
  const PostLogsParameters = z.union([
    PostLogsLogParameter,
    z.array(PostLogsLogParameter),
  ]);
  router.post('/runs/:id/logs', async (ctx) => {
    let runId = ctx.params.id;
    if (!ctx.session.run || ctx.session.run.id !== runId) {
      ctx.status = 403;
      return;
    }
    let params = parseRequestBody(PostLogsParameters, ctx);
    if (!Array.isArray(params)) {
      params = [params];
    }
    await store.addLogs(params.map((log) => ({ ...log, runId })));
    ctx.status = 200;
  });

  const GetLogsParameters = z.object({
    type: z.union([z.string(), z.array(z.string())]).optional(),
    runId: z.union([z.string(), z.array(z.string())]).optional(),
    experimentId: z.union([z.string(), z.array(z.string())]).optional(),
    format: z.enum(['json', 'csv']).default('json'),
  });
  router.get('/logs', async (ctx) => {
    let { format, ...filter } = parseRequestQuery(GetLogsParameters, ctx);
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
