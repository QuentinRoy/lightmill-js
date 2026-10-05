import type {
  InternalServerErrorResponse,
  RequestBodyTooLargeErrorResponse,
  RequestValidationErrorResponse,
  UnsupportedMediaTypeErrorResponse,
} from '@lightmill/log-api';
import { mediaType, sessionCookieName } from '@lightmill/log-api/vocabulary';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import express, { type NextFunction } from 'express';
import session from 'express-session';
import log from 'loglevel';
import MemorySessionStoreModule from 'memorystore';
import { createExperimentHandlers } from './app-experiments-handlers.ts';
import { createLogHandlers } from './app-logs-handlers.ts';
import { createOperationHandlers } from './app-operations-handlers.ts';
import { createRunHandlers } from './app-runs-handlers.ts';
import { createSessionHandlers } from './app-sessions-handlers.ts';
import type { DataStore } from './data-store.ts';
import {
  createRouter,
  getResponseMediaType,
  validateHandlers,
} from './router.ts';

// Room for a batch of logs from log-client and its envelope, and for a single
// large log. Not an option until someone needs one.
const REQUEST_BODY_LIMIT = '1mb';

const MemorySessionStore = MemorySessionStoreModule(session);

type CreateLogServerOptions = {
  dataStore: DataStore;
  hostUser?: string | undefined;
  hostPassword?: string | undefined;
  sessionKeys: string[];
  sessionStore?: session.Store;
  sessionMaxAge?: number | undefined;
  baseUrl?: string;
  trustProxy?: boolean | undefined;
} & (
  | { allowCrossOrigin?: boolean | undefined; secureCookies?: true | undefined }
  | { allowCrossOrigin: false; secureCookies?: boolean | undefined }
);

export function createLogServer({
  dataStore,
  sessionKeys,
  hostPassword,
  hostUser = 'host',
  allowCrossOrigin = true,
  secureCookies = allowCrossOrigin,
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
      type: [mediaType, 'application/json'],
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
      name: sessionCookieName,
      resave: false,
      saveUninitialized: false,
    }),
  );

  const handlers = validateHandlers({
    validateResponse: true,
    handlers: {
      ...createSessionHandlers({ hostPassword, hostUser }),
      ...createExperimentHandlers(),
      ...createRunHandlers(),
      ...createLogHandlers(),
      ...createOperationHandlers(),
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
          .header('content-type', getResponseMediaType(req.path))
          .json(bodyError.body);
        return;
      }
      log.error(err);
      res
        .status(500)
        .header('content-type', mediaType)
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
  // body-parser throws http-errors: `status` is 4xx for what the client got
  // wrong, `type` names it.
  const status =
    'status' in err && typeof err.status === 'number' ? err.status : 0;
  if (status < 400 || status >= 500) return null;
  const type = 'type' in err ? err.type : undefined;
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
  if (status === 415) {
    // An encoding or charset body-parser cannot decode.
    return {
      status: 415,
      body: {
        errors: [
          {
            status: 'Unsupported Media Type',
            code: 'UNSUPPORTED_MEDIA_TYPE',
            detail: err.message,
          },
        ],
      } satisfies StandardSchemaV1.InferOutput<
        typeof UnsupportedMediaTypeErrorResponse
      >,
    };
  }
  // Malformed JSON, aborted request, wrong length: nothing to retry either.
  return {
    status: 400,
    body: {
      errors: [
        {
          status: 'Bad Request',
          code: 'INVALID_REQUEST_BODY',
          // No `source`: a pointer must reference a value of the request
          // document, and there is no document.
          detail: err.message,
        },
      ],
    } satisfies StandardSchemaV1.InferOutput<
      typeof RequestValidationErrorResponse
    >,
  };
}
