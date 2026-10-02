/* eslint-disable no-empty-pattern */
/* eslint-disable @typescript-eslint/no-unused-vars */

import type { routes } from '@lightmill/log-api';
import express from 'express';
import { MemoryStore, Store as SessionStore } from 'express-session';
import { once } from 'node:events';
import { createServer, type RequestListener, type Server } from 'node:http';
import { last } from 'remeda';
import request from 'supertest';
import type { Simplify, ValueOf } from 'type-fest';
import { onTestFinished, test, vi, type Mock, type TestAPI } from 'vitest';
import { apiMediaType, type HttpMethod } from '../src/api.ts';
import { LogServer } from '../src/app.ts';
import type {
  DataStore,
  DataStoreTransaction,
  RunId,
  RunStatus,
} from '../src/data-store.ts';
import { SQLiteDataStore } from '../src/sqlite-data-store.ts';

// supertest would listen on `::` and connect to 127.0.0.1, where another process
// may hold the same port (e.g. Steam on macOS). Binding 127.0.0.1 avoids that.
export async function listen(app: RequestListener): Promise<Server> {
  const server = createServer(app).listen(0, '127.0.0.1');
  onTestFinished(() => {
    server.close();
    server.closeAllConnections();
  });
  await once(server, 'listening');
  return server;
}

export const host = 'lightmill-test.com';

type ApiRoutes = typeof routes;
type RouteMap<T = unknown> = {
  [P in keyof ApiRoutes]: {
    [M in keyof ApiRoutes[P] as Extract<M, HttpMethod>]: T;
  };
};
type Route = Simplify<
  ValueOf<{
    [P in keyof RouteMap]: ValueOf<{
      [M in keyof RouteMap[P]]: { path: P; method: M };
    }>;
  }>
>;
type RouteEntry = { requireAuth: boolean };

export function createAllRoute() {
  // This is the easiest way I found to ensure we capture all routes.
  // We cannot use an array directly because there is no way to know
  // an array would be exhaustive (it's possible with a tuple, but
  // they are order dependent so hard to deal with).
  const routeMap: RouteMap<Partial<RouteEntry>> = {
    '/sessions': { post: { requireAuth: false } },
    '/sessions/{id}': {
      get: { requireAuth: false },
      delete: { requireAuth: false },
    },
    '/experiments': {
      get: { requireAuth: false },
      post: { requireAuth: false },
    },
    '/experiments/{id}': { get: { requireAuth: false } },
    '/runs': { get: {}, post: {} },
    '/runs/{id}': { get: {}, patch: {} },
    '/logs': { get: {}, post: {} },
    '/logs/{id}': { get: {} },
    '/operations': { post: {} },
  };
  const result: Array<Route & RouteEntry> = [];
  for (let p of Object.keys(routeMap)) {
    // @ts-expect-error This is fine.
    const pathEntry = routeMap[p];
    for (let m of Object.keys(pathEntry)) {
      result.push({ path: p, method: m, requireAuth: true, ...pathEntry[m] });
    }
  }
  return result;
}

export function idCompare(a: { id: string }, b: { id: string }) {
  return a.id.localeCompare(b.id, 'en');
}

export function generateCombinations<T>(values: Iterable<T>) {
  let combinations: Array<[T, T]> = [];
  for (let v1 of values) {
    for (let v2 of values) {
      combinations.push([v1, v2]);
    }
  }
  return combinations;
}

function assertTypeExtends<U extends T, T>() {}

export const runStatus = [
  'canceled',
  'completed',
  'running',
  'idle',
  'interrupted',
] as const;
type ProvidedStatus = (typeof runStatus)[number];
type ForgottenStatus = Exclude<RunStatus, ProvidedStatus>;
// This will fail if `ForgottenStatus` is not empty, which happens if not all
// possible run statuses are covered.
assertTypeExtends<ForgottenStatus, never>();

export const apiContentTypeRegExp = new RegExp(
  `^${apiMediaType.replaceAll(/(\.|\/|\+)/g, '\\$1')}(;\\s*charset=[^\\s]+)?$`,
);

export const atomicContentTypeRegExp =
  /^application\/vnd\.api\+json(;\s*charset=[^\s;]+)?;\s*ext="https:\/\/jsonapi\.org\/ext\/atomic"/;

const baseServerOptions = {
  sessionKeys: ['secret'],
  allowCrossOrigin: false as const,
  secureCookies: false,
};

type ServerOptions = { hostPassword?: string; hostUser?: string };
async function createServerContextFromStores<
  ThisDataStore extends DataStore,
  ThisSessionStore extends SessionStore,
  ServerType extends string,
>({
  dataStore,
  sessionStore,
  type,
  serverOptions,
}: {
  dataStore: ThisDataStore;
  sessionStore: ThisSessionStore;
  type: ServerType;
  serverOptions?: ServerOptions;
}) {
  return {
    server: LogServer({
      dataStore: dataStore,
      sessionStore,
      ...baseServerOptions,
      ...serverOptions,
    }),
    dataStore,
    sessionStore,
    type,
  };
}

export const storeTypes = ['sqlite'] as const;
export type StoreType = (typeof storeTypes)[number];
export interface ServerContext {
  dataStore: MockedDataStore;
  sessionStore: WithMockedMethods<SessionStore>;
}
export const dataStoreCreators = {
  async sqlite() {
    const dataStore = await SQLiteDataStore.open(':memory:');
    return mockDataStore(dataStore);
  },
} satisfies Record<StoreType, () => Promise<MockedDataStore>>;
export const sessionStoreCreators = {
  async sqlite() {
    return mockMethods<SessionStore>(new MemoryStore());
  },
} satisfies Record<StoreType, () => Promise<WithMockedMethods<SessionStore>>>;
// @ts-expect-error We will fill this up just after.
const storesCreators: Record<StoreType, () => Promise<ServerContext>> = {};
for (let storeType of storeTypes) {
  storesCreators[storeType] = async () => {
    const [dataStore, sessionStore] = await Promise.all([
      dataStoreCreators[storeType](),
      sessionStoreCreators[storeType](),
    ]);
    return { dataStore, sessionStore };
  };
}

type StoreCreatorsMap = typeof storesCreators;
type StoreContextMap = {
  [K in keyof StoreCreatorsMap]: Awaited<ReturnType<StoreCreatorsMap[K]>>;
};
export type ServerFromStores<
  ThisDataStore extends DataStore,
  ThisSessionStore extends SessionStore,
  ServerType extends string,
> = Awaited<
  ReturnType<
    typeof createServerContextFromStores<
      ThisDataStore,
      ThisSessionStore,
      ServerType
    >
  >
>;
export type ServerFromDefaultTypes<Type extends StoreType> = ServerFromStores<
  StoreContextMap[Type]['dataStore'],
  StoreContextMap[Type]['sessionStore'],
  Type
>;

function isDefaultServerTypeOptions(
  value: unknown,
): value is { type: StoreType } {
  return (
    typeof value === 'object' &&
    value != null &&
    'type' in value &&
    typeof value.type === 'string' &&
    Object.keys(storesCreators).includes(value.type)
  );
}

type CreateServerBaseOptions = { serverOptions?: ServerOptions };
export async function createServerContext<Type extends StoreType>(
  options: { type: Type } & CreateServerBaseOptions,
): Promise<ServerFromDefaultTypes<Type>>;
export async function createServerContext<
  ThisDataStore extends DataStore,
  ThisSessionStore extends SessionStore,
>(
  options: {
    dataStore: ThisDataStore;
    sessionStore: ThisSessionStore;
  } & CreateServerBaseOptions,
): Promise<ServerFromStores<ThisDataStore, ThisSessionStore, 'custom'>>;
export async function createServerContext(
  options: (
    | { dataStore: DataStore; sessionStore: SessionStore }
    | { type: StoreType }
  ) &
    CreateServerBaseOptions,
) {
  if (isDefaultServerTypeOptions(options)) {
    const { dataStore, sessionStore } = await storesCreators[options.type]();
    return createServerContextFromStores({
      ...options,
      dataStore,
      sessionStore,
    });
  }
  return createServerContextFromStores({ type: 'custom', ...options });
}

export type App = Parameters<typeof request.agent>[0];

type Role = 'host' | 'participant';

type SessionFixtureContext<
  R extends Role = Role,
  T extends StoreType = StoreType,
> = {
  api: request.Agent;
  role: R;
  type: T;
  app: NonNullable<Parameters<typeof request.agent>[0]>;
} & StoreContextMap[T];
export type SessionFixture<R extends Role, T extends StoreType = StoreType> = {
  session: SessionFixtureContext<R, T>;
};
type PatchedFixture<
  Fixture extends Record<PropertyKey, unknown>,
  Patch extends Record<PropertyKey, unknown>,
> = { [K in keyof Fixture]: Fixture[K] & Patch };

async function createSessionFixtureContext<
  R extends 'host' | 'participant',
  T extends StoreType,
>({ type, role }: { type: T; role: R }) {
  let serverContext = await createServerContext({ type });
  let app = await listen(express().use(serverContext.server.middleware));
  let api = request.agent(app).host(host);
  // This request only matters to get the cookie. After that we'll mock the session anyway.
  const response = await api
    .post('/sessions')
    .set('Content-Type', apiMediaType)
    .send({ data: { type: 'sessions', attributes: { role } } })
    .expect(201);
  vi.clearAllMocks();
  return { ...serverContext, api, role, app };
}

export type SetupFunction<
  R extends Role,
  T extends StoreType,
  ContextPatch extends Record<string, unknown> | void,
> = (
  context: SessionFixtureContext<R, T>,
) => Promise<ContextPatch> | ContextPatch;
export type SetupMap<
  R extends Role,
  ContextPatch extends Record<string, unknown> | void,
> = { [K in StoreType]: SetupFunction<R, K, ContextPatch> };

type CreateSessionTestBaseOptions<R extends Role, T extends StoreType> = {
  storeType: T;
  sessionType: R;
};
export function createSessionTest<
  R extends Role,
  T extends StoreType,
  Patch extends Record<string, unknown>,
>(
  options: CreateSessionTestBaseOptions<R, T> & {
    setup: SetupFunction<R, T, Patch> | SetupMap<R, Patch>;
  },
): TestAPI<PatchedFixture<SessionFixture<R, T>, Patch>>;
export function createSessionTest<R extends Role, T extends StoreType>(
  options: CreateSessionTestBaseOptions<R, T> & {
    setup?: SetupFunction<R, T, void> | SetupMap<R, void>;
  },
): TestAPI<SessionFixture<R, T>>;
export function createSessionTest(
  options: CreateSessionTestBaseOptions<Role, StoreType> & {
    setup?:
      | SetupFunction<Role, StoreType, Record<string, unknown> | void>
      | SetupMap<Role, Record<string, unknown> | void>;
  },
) {
  let setupFn = (context: SessionFixtureContext) => {
    if (options.setup == null) {
      return;
    }
    if (typeof options.setup === 'function') {
      return options.setup(context);
    }
    return options.setup[options.storeType](context);
  };
  return test.extend({
    session: async ({}, use) => {
      const context = await createSessionFixtureContext({
        role: options.sessionType,
        type: options.storeType,
      });
      const patch = await setupFn(context);
      await use({ ...context, ...patch });
    },
  });
}

export type WithMockedMethods<T extends object> = {
  // The intersection keeps the original signature, so a generic method (like
  // withTransaction) stays generic.
  [K in keyof T]: T[K] extends (...args: never[]) => unknown
    ? T[K] & Mock<T[K]>
    : T[K];
};
export function mockMethods<T extends object>(obj: T): WithMockedMethods<T> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const proxiedMethods = new Map<PropertyKey, Mock<any>>();
  return new Proxy(obj, {
    get(target, prop) {
      let proxiedMethod = proxiedMethods.get(prop);
      if (proxiedMethod != null) {
        return proxiedMethod;
      }
      let value = Reflect.get(target, prop);
      if (typeof value === 'function') {
        let newProxiedMethod = vi.fn(value.bind(target));
        proxiedMethods.set(prop as string, newProxiedMethod);
        return newProxiedMethod;
      }
      return value;
    },
  }) as WithMockedMethods<T>;
}

/**
 * A store whose methods are spies. `tx` holds the spies of the transaction
 * methods: they are shared by every transaction, and call the real one.
 */
export type MockedDataStore = WithMockedMethods<DataStore> & {
  tx: WithMockedMethods<DataStoreTransaction>;
};
export function mockDataStore(store: DataStore): MockedDataStore {
  let current: DataStoreTransaction | undefined;
  const txSpies = new Map<PropertyKey, Mock>();
  // Resolved at call time: a spy keeps working across transactions.
  const getTxSpy = (prop: PropertyKey) => {
    let spy = txSpies.get(prop);
    if (spy == null) {
      spy = vi.fn((...args: unknown[]) => {
        if (current == null) throw new Error('No transaction is active');
        // The method name is only known at call time, and the spy stands in
        // for every method of the transaction.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (current as any)[prop](...args);
      });
      txSpies.set(prop, spy);
    }
    return spy;
  };
  const tx = new Proxy({}, { get: (_, prop) => getTxSpy(prop) });
  // The proxy adds `tx` and swaps `withTransaction`, which the mapped type of
  // WithMockedMethods cannot express.
  return mockMethods(
    new Proxy(store, {
      get(target, prop) {
        if (prop === 'tx') return tx;
        if (prop === 'withTransaction') {
          return (fn: (tx: DataStoreTransaction) => Promise<unknown>) =>
            target.withTransaction(async (realTx) => {
              const previous = current;
              current = realTx;
              try {
                // The proxy only hands out spies for transaction methods.
                return await fn(tx as DataStoreTransaction);
              } finally {
                current = previous;
              }
            });
        }
        const value = Reflect.get(target, prop);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }),
  ) as MockedDataStore;
}

export async function addRunToSession({
  api,
  runId,
  sessionStore,
}: {
  api: request.Agent;
  sessionStore: WithMockedMethods<SessionStore>;
  runId: RunId;
}) {
  // I have not found a better way to get the session cookie. request.Agent does
  // expose a `jar` property, but I could not find a way to get the session id
  // from it. Maybe because it isn't supposed to be accessible with JavaScript?
  await api.get('/sessions/current');
  const sessionId = last(sessionStore.get.mock.calls)?.[0];
  if (sessionId == null) {
    throw new Error('No session cookie found');
  }
  return new Promise((resolve, reject) => {
    sessionStore.get(sessionId, (err, session) => {
      if (err) {
        return reject(err);
      }
      if (session == null) {
        return reject(
          new Error(`Session not found for cookie value: ${sessionId}`),
        );
      }
      const data = session.data;
      if (data == null) {
        return reject(new Error(`Session data is not initialized`));
      }
      if (session.data.runs.includes(runId)) {
        return resolve(session); // Run already exists in the session
      }
      const newRuns = [...session.data.runs, runId];
      session.data = { ...data, runs: newRuns };
      sessionStore.set(sessionId, session, (err) => {
        if (err) {
          return reject(err);
        }
        resolve(session);
      });
    });
  });
}
