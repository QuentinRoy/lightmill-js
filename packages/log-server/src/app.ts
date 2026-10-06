import { sessionCookieName } from '@lightmill/log-api/vocabulary';
import type express from 'express';
import session from 'express-session';
import MemorySessionStoreModule from 'memorystore';
import { createExperimentHandlers } from './app-experiments-handlers.ts';
import { createLogHandlers } from './app-logs-handlers.ts';
import { createOperationHandlers } from './app-operations-handlers.ts';
import { createRunHandlers } from './app-runs-handlers.ts';
import { createSessionHandlers } from './app-sessions-handlers.ts';
import type { DataStore } from './data-store.ts';
import { createRequestMiddleware } from './request-handling.ts';

const MemorySessionStore = MemorySessionStoreModule(session);

type CreateLogServerOptions = {
  dataStore: DataStore;
  hostUser?: string | undefined;
  hostPassword?: string | undefined;
  sessionKeys: string[];
  sessionStore?: session.Store;
  sessionMaxAge?: number | undefined;
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
  const middleware = createRequestMiddleware({
    dataStore,
    trustProxy,
    sessionMiddleware: session({
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
    handlers: {
      ...createSessionHandlers({ hostPassword, hostUser }),
      ...createExperimentHandlers(),
      ...createRunHandlers(),
      ...createLogHandlers(),
      ...createOperationHandlers(),
    },
  });

  return { middleware };
}
