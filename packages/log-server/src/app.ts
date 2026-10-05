import { mediaType, sessionCookieName } from '@lightmill/log-api/vocabulary';
import express from 'express';
import session from 'express-session';
import MemorySessionStoreModule from 'memorystore';
import { createExperimentHandlers } from './app-experiments-handlers.ts';
import { createLogHandlers } from './app-logs-handlers.ts';
import { createOperationHandlers } from './app-operations-handlers.ts';
import { createRunHandlers } from './app-runs-handlers.ts';
import { createSessionHandlers } from './app-sessions-handlers.ts';
import type { DataStore } from './data-store.ts';
import {
  createErrorHandler,
  createRouter,
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

  app.use(createErrorHandler({ requestBodyLimit: REQUEST_BODY_LIMIT }));

  return { middleware: app };
}
