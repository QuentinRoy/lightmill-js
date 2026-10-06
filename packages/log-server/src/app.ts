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
import { isValidHostPassword } from './utils.ts';

const MemorySessionStore = MemorySessionStoreModule(session);

type SecureCookies = 'auto' | 'always' | 'never';

type CreateLogServerOptions = {
  dataStore: DataStore;
  hostUser?: string | undefined;
  hostPassword: string;
  sessionKeys: string[];
  sessionStore?: session.Store;
  sessionMaxAge?: number | undefined;
  trustProxy?: boolean | undefined;
} & (
  | {
      cookieSite?: 'cross-site' | undefined;
      secureCookies?: 'always' | undefined;
    }
  | { cookieSite: 'same-site'; secureCookies?: SecureCookies | undefined }
);

export function createLogServer({
  dataStore,
  sessionKeys,
  hostPassword,
  hostUser = 'host',
  cookieSite = 'cross-site',
  secureCookies = cookieSite === 'same-site' ? 'auto' : 'always',
  sessionStore = new MemorySessionStore({ checkPeriod: 1000 * 60 * 60 * 24 }),
  sessionMaxAge,
  trustProxy = false,
}: CreateLogServerOptions): { middleware: express.RequestHandler } {
  // The type already requires it, but a JavaScript caller (or an unset
  // environment variable) would otherwise open every host route to anyone.
  if (!isValidHostPassword(hostPassword)) {
    throw new TypeError('createLogServer requires a non-empty hostPassword.');
  }
  const middleware = createRequestMiddleware({
    dataStore,
    trustProxy,
    sessionMiddleware: session({
      store: sessionStore,
      secret: sessionKeys,
      cookie: {
        sameSite: cookieSite === 'cross-site' ? 'none' : 'strict',
        // Same-site cookies also work over plain HTTP (development), so by
        // default `Secure` follows the request protocol. Behind a
        // TLS-terminating proxy, that relies on `trustProxy`.
        secure: secureCookies === 'auto' ? 'auto' : secureCookies === 'always',
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
