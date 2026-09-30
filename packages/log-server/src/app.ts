import type {
  InternalServerErrorResponse,
  RequestBodyTooLargeErrorResponse,
  RequestValidationErrorResponse,
} from '@lightmill/log-api';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import express, { type NextFunction } from 'express';
import session from 'express-session';
import log from 'loglevel';
import MemorySessionStoreModule from 'memorystore';
import { apiMediaType, atomicMediaType } from './api.ts';
import { experimentHandlers } from './app-experiments-handlers.ts';
import { logHandlers } from './app-logs-handlers.ts';
import { operationHandlers } from './app-operations-handlers.ts';
import { runHandlers } from './app-runs-handlers.ts';
import { sessionHandlers } from './app-sessions-handlers.ts';
import type { DataStore } from './data-store.ts';
import { createRouter, validateHandlers } from './router.ts';

export const SESSION_COOKIE_NAME = 'lightmill-session-id';

// A batch is at most about 512 kB for log-client; 1 MB leaves room for its
// envelope and for a single large log. Not an option until someone needs one.
const REQUEST_BODY_LIMIT = '1mb';

const MemorySessionStore = MemorySessionStoreModule(session);

type CreateLogServerOptions = {
  dataStore: DataStore;
  hostUser?: string | undefined;
  hostPassword?: string | undefined;
  mode?: 'development' | 'production' | 'test' | (string & {}) | undefined;
  sessionKeys: string[];
  sessionStore?: session.Store;
  sessionMaxAge?: number | undefined;
  baseUrl?: string;
  trustProxy?: boolean | undefined;
} & (
  | { allowCrossOrigin?: boolean | undefined; secureCookies?: true | undefined }
  | { allowCrossOrigin: false; secureCookies?: boolean | undefined }
);

export function LogServer({
  dataStore,
  sessionKeys,
  hostPassword,
  hostUser = 'host',
  allowCrossOrigin = true,
  secureCookies = allowCrossOrigin,
  mode = process.env.NODE_ENV ?? 'production',
  sessionStore = new MemorySessionStore({ checkPeriod: 1000 * 60 * 60 * 24 }),
  sessionMaxAge,
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

  app.use(
    express.json({
      type: [apiMediaType, 'application/json'],
      limit: REQUEST_BODY_LIMIT,
    }),
  );

  app.use(
    session({
      store: sessionStore,
      secret: sessionKeys,
      cookie: {
        sameSite: allowCrossOrigin ? 'none' : 'strict',
        secure: secureCookies,
        httpOnly: true,
        ...(sessionMaxAge === undefined ? {} : { maxAge: sessionMaxAge }),
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
      ...operationHandlers(),
    },
  });

  app.use(createRouter({ handlers, dataStore }));

  app.use(
    (
      err: Error,
      req: express.Request,
      res: express.Response,
      // We don't use _next, but we do need to declare all four parameters
      // so express recognizes it as an error handler middleware.
      _next: NextFunction,
    ) => {
      // Body-parser errors are the client's: answering them with a 500 would
      // make log-client retry a request that can never succeed.
      const bodyError = getBodyParserError(err);
      if (bodyError != null) {
        res
          .status(bodyError.status)
          // Same media type as the router uses for this route's responses.
          .header(
            'content-type',
            req.path === '/operations' ? atomicMediaType : apiMediaType,
          )
          .json(bodyError.body);
        return;
      }
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

function getBodyParserError(err: Error) {
  // body-parser throws http-errors: `type` tells which one, `status` is 4xx.
  const { type, status } = err as Error & { type?: unknown; status?: unknown };
  if (type === 'entity.too.large') {
    return {
      status: 413,
      body: {
        errors: [
          {
            status: 'Payload Too Large',
            code: 'REQUEST_BODY_TOO_LARGE',
            detail: `Request body must not exceed ${REQUEST_BODY_LIMIT}.`,
          },
        ],
      } satisfies StandardSchemaV1.InferOutput<
        typeof RequestBodyTooLargeErrorResponse
      >,
    };
  }
  if (status === 400) {
    return {
      status: 400,
      body: {
        errors: [
          {
            status: 'Bad Request',
            code: 'INVALID_REQUEST_BODY',
            detail: err.message,
            // The body is not even a JSON document: the error is its root.
            source: { pointer: '' },
          },
        ],
      } satisfies StandardSchemaV1.InferOutput<
        typeof RequestValidationErrorResponse
      >,
    };
  }
  return null;
}
