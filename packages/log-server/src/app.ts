import type { InternalServerErrorResponse } from '@lightmill/log-api';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import express, { type NextFunction } from 'express';
import session from 'express-session';
import log from 'loglevel';
import MemorySessionStoreModule from 'memorystore';
import { apiMediaType } from './api.ts';
import { experimentHandlers } from './app-experiments-handlers.js';
import { logHandlers } from './app-logs-handlers.js';
import { runHandlers } from './app-runs-handlers.js';
import { sessionHandlers } from './app-sessions-handlers.js';
import type { DataStore } from './data-store.ts';
import { createRouter, validateHandlers } from './router.ts';

export const SESSION_COOKIE_NAME = 'lightmill-session-id';

const MemorySessionStore = MemorySessionStoreModule(session);

interface CreateLogServerOptions {
  dataStore: DataStore;
  hostUser?: string | undefined;
  hostPassword?: string | undefined;
  allowCrossOrigin?: boolean | undefined;
  mode?: 'development' | 'production' | 'test' | (string & {}) | undefined;
  sessionKeys: string[];
  secureCookies?: boolean | undefined;
  sessionStore?: session.Store;
  baseUrl?: string;
  trustProxy?: boolean | undefined;
}

export function LogServer({
  dataStore,
  sessionKeys,
  hostPassword,
  hostUser = 'host',
  allowCrossOrigin = true,
  secureCookies = allowCrossOrigin,
  mode = process.env.NODE_ENV ?? 'production',
  sessionStore = new MemorySessionStore({ checkPeriod: 1000 * 60 * 60 * 24 }),
  trustProxy = true,
}: CreateLogServerOptions): { middleware: express.RequestHandler } {
  const app = express();

  app.set('trust proxy', trustProxy);

  app.set('query parser', (str: string | null) => {
    if (str == null) return {};
    let params = new URLSearchParams(decodeURIComponent(str));
    let values: Record<string, string[] | string> = {};
    for (const [key, value] of params.entries()) {
      let oldValue = values[key];
      if (oldValue == null) {
        values[key] = value;
      } else if (Array.isArray(oldValue)) {
        oldValue.push(value);
      } else {
        values[key] = [oldValue, value];
      }
    }
    return values;
  });

  app.use(express.json({ type: [apiMediaType, 'application/json'] }));

  app.use(
    session({
      store: sessionStore,
      secret: sessionKeys,
      cookie: {
        sameSite: allowCrossOrigin ? 'none' : 'strict',
        secure: secureCookies,
        httpOnly: true,
      },
      name: SESSION_COOKIE_NAME,
      resave: false,
      saveUninitialized: false,
    }),
  );

  const handlers = validateHandlers({
    validateResponse: mode !== 'test',
    handlers: {
      ...sessionHandlers({ hostPassword, hostUser }),
      ...experimentHandlers(),
      ...runHandlers(),
      ...logHandlers(),
    },
  });

  app.use(createRouter({ handlers, dataStore }));

  app.use(
    (
      err: Error,
      _req: express.Request,
      res: express.Response,
      // We don't use _next, but we do need to declare all four parameters
      // so express recognizes it as an error handler middleware.
      _next: NextFunction,
    ) => {
      log.error(err);
      res
        .status(500)
        .header('content-type', apiMediaType)
        .json({
          errors: [
            {
              status: 'Internal Server Error',
              code: 'INTERNAL_SERVER_ERROR',
              detail: err.message,
            },
          ],
        } satisfies StandardSchemaV1.InferOutput<
          typeof InternalServerErrorResponse
        >);
    },
  );

  return { middleware: app };
}
