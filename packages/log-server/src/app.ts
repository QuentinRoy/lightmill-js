import { sessionCookieName } from '@lightmill/log-api/vocabulary';
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
  MalformedQueryError,
  validateHandlers,
} from './router.ts';

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
    // URLSearchParams decodes malformed percent-encoding into U+FFFD, which
    // would filter on a value the client never sent.
    for (const pair of str.split('&')) {
      const [key = ''] = pair.split('=', 1);
      if (!isDecodable(key)) throw new MalformedQueryError(key);
      if (!isDecodable(pair)) {
        throw new MalformedQueryError(
          decodeURIComponent(key.replaceAll('+', ' ')),
        );
      }
    }
    let params = new URLSearchParams(str);
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

  app.use(createErrorHandler());

  return { middleware: app };
}

function isDecodable(component: string) {
  try {
    decodeURIComponent(component);
    return true;
  } catch {
    return false;
  }
}
