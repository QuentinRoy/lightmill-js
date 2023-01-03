import koa from 'koa';
import Router from '@koa/router';
import bodyParser from 'koa-bodyparser';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import dotenv from 'dotenv';
import session from 'koa-generic-session';
import { Readable } from 'node:stream';
import {
  formatErrorMiddleware as formatValidationError,
  parseRequestBody,
  parseRequestQuery,
} from './validate.js';
import { Store } from './store.js';
import { SessionStoreAdapter } from './session-store-adapter.js';
import { JsonValue } from 'type-fest';
import { stringify } from 'csv';
import { pickBy } from 'lodash-es';

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

export function App({ store }: { store: Store }) {
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
  const logColumns = ['type', 'experimentId', 'runId', 'createdAt'] as const;
  router.get('/logs', async (ctx) => {
    let { format, ...filter } = parseRequestQuery(GetLogsParameters, ctx);
    let logs = store.getLogs(filter);
    if (format === 'csv') {
      let valueColumns = await store.getLogValueNames(filter);
      let hasNonEmptyExperimentId = await store.hasNonEmptyExperimentId();
      let logColumnFilter = (c: string) =>
        !valueColumns.includes(c) &&
        (hasNonEmptyExperimentId || c !== 'experimentId');
      let columns = [...logColumns.filter(logColumnFilter), ...valueColumns];
      ctx.body = getLogsCSVStream(columns, logs, ({ values, ...log }) => ({
        ...pickBy(log, (v, k) => logColumnFilter(k)),
        ...values,
      }));
      ctx.headers['content-type'] = 'text/csv';
    } else {
      ctx.body = getLogsJSONStream(logs);
      ctx.headers['content-type'] = 'application/json';
    }
    ctx.status = 200;
  });

  app.keys = [secret];
  app.use(router.routes());
  app.use(router.allowedMethods());
  return app;
}

function getLogsJSONStream(
  logs: AsyncGenerator<Record<string, JsonValue | Date | undefined>>
) {
  let started = false;
  return new Readable({
    read() {
      let willAddComma = started;
      if (!started) {
        this.push('[');
        started = true;
      }
      logs
        .next()
        .then(({ done, value }) => {
          if (done) {
            this.push(']');
            this.push(null);
          } else {
            if (willAddComma) this.push(',');
            this.push(JSON.stringify(value, stringifyDateReplacer));
          }
        })
        .catch((error) => {
          this.emit('error', error);
        });
    },
  });
}

function getLogsCSVStream<T>(
  columns: string[],
  logs: AsyncGenerator<T>,
  map: (log: T) => Record<string, unknown>
) {
  return new Readable({
    objectMode: true,
    read() {
      logs
        .next()
        .then(({ done, value }) => {
          if (done) {
            this.push(null);
          } else {
            this.push(map(value));
          }
        })
        .catch((error) => {
          this.emit('error', error);
        });
    },
  }).pipe(
    stringify({
      header: true,
      columns,
      cast: {
        date: (value) => value.toISOString(),
        number: (value) => value.toString(),
        object: (value) => JSON.stringify(value),
        bigint: (value) => value.toString(),
        boolean: (value) => (value ? 'true' : 'false'),
      },
    })
  );
}

function stringifyDateReplacer(key: string, value: unknown) {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return value;
}
