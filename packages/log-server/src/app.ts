import { match, P } from '@gabriel/ts-pattern';
import { openAPI as lightmillAPI, type components } from '@lightmill/log-api';
import cookieParser from 'cookie-parser';
import express, { type NextFunction } from 'express';
import * as OpenApiValidator from 'express-openapi-validator';
import type {
  OpenAPIV3,
  ValidationErrorItem,
} from 'express-openapi-validator/dist/framework/types.js';
import session, { Store as SessionStore } from 'express-session';
import log from 'loglevel';
import MemorySessionStoreModule from 'memorystore';
import { experimentHandlers } from './app-experiments-handlers.js';
import { logHandlers } from './app-logs-handlers.js';
import { runHandlers } from './app-runs-handlers.js';
import { sessionHandlers } from './app-sessions-handlers.js';
import type { ServerApi } from './app-utils.js';
import type { Store } from './store.js';
import { createTypedExpressServer } from './typed-server.js';
import { firstStrict } from './utils.js';

const SESSION_COOKIE_NAME = 'lightmill-session-id';

const MemorySessionStore = MemorySessionStoreModule(session);

type CreateLogServerOptions = {
  store: Store;
  hostUser?: string | undefined;
  hostPassword?: string | undefined;
  allowCrossOrigin?: boolean | undefined;
  mode?: 'development' | 'production' | 'test' | (string & {}) | undefined;
  sessionKeys: string[];
  secureCookies?: boolean | undefined;
  sessionStore?: SessionStore;
  baseUrl?: string;
};

export function LogServer({
  store,
  sessionKeys,
  hostPassword,
  hostUser = 'host',
  allowCrossOrigin = true,
  secureCookies = allowCrossOrigin,
  mode = process.env.NODE_ENV ?? 'production',
  sessionStore = new MemorySessionStore({ checkPeriod: 1000 * 60 * 60 * 24 }),
  baseUrl = '/',
}: CreateLogServerOptions): { middleware: express.RequestHandler } {
  const app = express();

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

  app.use(express.json());

  // Required for open api validator, but be careful to use
  // the same keys as the session middleware.
  app.use(cookieParser(sessionKeys));

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

  app.use(
    OpenApiValidator.middleware({
      apiSpec: {
        ...(lightmillAPI as OpenAPIV3.DocumentV3),
        servers: [{ url: baseUrl }],
      },
      validateApiSpec: mode !== 'production',
      validateRequests: { allErrors: mode !== 'production' },
      validateResponses: mode !== 'production',
      validateSecurity: {
        handlers: {
          CookieSessionAuth: (req, _token, _schema) => {
            if (req.session.data != null) return true;
            throw new Error('Login required');
          },
        },
      },
    }),
  );

  createTypedExpressServer<ServerApi>(
    store,
    {
      ...sessionHandlers({ hostPassword, hostUser }),
      ...experimentHandlers(),
      ...runHandlers(),
      ...logHandlers(),
    },
    app,
  );

  app.use(
    (
      err: Error,
      req: express.Request,
      res: express.Response,
      _next: NextFunction,
    ) => {
      if (
        err instanceof OpenApiValidator.error.BadRequest ||
        err instanceof OpenApiValidator.error.NotFound ||
        err instanceof OpenApiValidator.error.MethodNotAllowed ||
        err instanceof OpenApiValidator.error.UnsupportedMediaType ||
        err instanceof OpenApiValidator.error.Unauthorized ||
        err instanceof OpenApiValidator.error.Forbidden
      ) {
        for (let [key, value] of Object.entries(err.headers ?? {})) {
          res.header(key, value);
        }
        const errorEntries = err.errors.map((errItem) =>
          getErrorEntry({
            errorItem: errItem,
            errorStatus: err.status,
            errorName: err.name,
            request: req,
            baseUrl: baseUrl,
          }),
        );
        res
          .status(firstStrict(errorEntries).statusCode)
          .json({ errors: errorEntries.map((error) => error.content) });
        return;
      }
      throw err;
    },
  );

  app.use(
    (
      err: Error,
      _req: express.Request,
      res: express.Response,
      // We don't use _next, but we need to declare all four parameters
      // so its an error handler middleware.
      _next: NextFunction,
    ) => {
      log.error(err);
      res
        .status(500)
        .json({
          errors: [
            {
              status: 'Internal Server Error',
              code: 'INTERNAL_SERVER',
              detail: err.message,
            },
          ],
        } satisfies components['schemas']['NonRouterErrorDocument']);
    },
  );

  return { middleware: app };
}

type NonRouterError =
  components['schemas']['NonRouterErrorDocument']['errors'][number];
type SessionRequiredError = components['schemas']['Utils.SessionRequiredError'];

function getErrorEntry(options: {
  errorItem: ValidationErrorItem;
  errorStatus: number;
  errorName: string;
  request: express.Request;
  baseUrl: string;
}) {
  return match(options)
    .returnType<{
      statusCode: number;
      content: NonRouterError | SessionRequiredError;
    }>()
    .with(
      P.union(
        { errorStatus: 404 },
        {
          errorStatus: 400,
          errorItem: { path: P.when((p) => p.startsWith('/params/')) },
        },
      ),
      ({ request }) => ({
        statusCode: 404,
        content: {
          status: 'Not Found',
          code: 'NOT_FOUND',
          detail: `resource ${request.originalUrl} does not exist`,
        },
      }),
    )
    .with({ errorStatus: 405 }, ({ errorItem }) => ({
      statusCode: 405,
      content: {
        status: 'Method Not Allowed',
        code: 'METHOD_NOT_ALLOWED',
        detail: errorItem.message,
      },
    }))
    .with({ errorStatus: 415 }, ({ errorItem }) => ({
      statusCode: 415,
      content: {
        status: 'Unsupported Media Type',
        code: 'UNSUPPORTED_MEDIA_TYPE',
        detail: errorItem.message,
      },
    }))
    .with(
      {
        errorStatus: 400,
        errorItem: { path: P.string.startsWith('/headers') },
      },
      ({ errorItem }) => {
        return {
          statusCode: 400,
          content: {
            status: 'Bad Request',
            code: 'HEADERS_VALIDATION',
            detail: errorItem.message,
            source: { header: errorItem.path.substring('/headers/'.length) },
          },
        };
      },
    )
    .with(
      { errorStatus: 400, errorItem: { path: P.string.startsWith('/body') } },
      ({ errorItem }) => ({
        statusCode: 400,
        content: {
          status: 'Bad Request',
          code: 'BODY_VALIDATION',
          detail: errorItem.message,
          source: { pointer: errorItem.path.substring('/body'.length) },
        },
      }),
    )
    .with(
      { errorStatus: 400, errorItem: { path: P.string.startsWith('/query') } },
      ({ errorItem }) => ({
        statusCode: 400,
        content: {
          status: 'Bad Request',
          code: 'QUERY_VALIDATION',
          detail: errorItem.message,
          source: { parameter: errorItem.path.substring('/query/'.length) },
        },
      }),
    )
    .with({ errorStatus: 401 }, () => {
      let postPath = `${options.baseUrl}${options.baseUrl.endsWith('/') ? '' : '/'}sessions`;
      return {
        statusCode: 403,
        content: {
          status: 'Forbidden',
          code: 'SESSION_REQUIRED',
          detail: `session required, post to ${postPath}`,
        },
      };
    })
    .run();
}
