/* eslint-disable no-empty-pattern */
/* eslint-disable @typescript-eslint/no-unused-vars */

import type { paths } from '@lightmill/log-api';
import express from 'express';
import { MemoryStore, Store as SessionStore } from 'express-session';
import { default as request, default as supertest } from 'supertest';
import type { RequiredKeysOf, Simplify, ValueOf } from 'type-fest';
import { test, vi, type TestAPI } from 'vitest';
import {
  createMockStore,
  type MockStore,
} from '../__mocks__/mock-data-store.ts';
import { MockSessionStore } from '../__mocks__/mock-session-store.ts';
import type { HttpMethod } from '../src/api-utils.js';
import { apiMediaType } from '../src/app-utils.ts';
import { LogServer } from '../src/app.js';
// storeTypeSymbol is required by TS even if not used it directly.
import type { storeTypeSymbol } from '../src/store-types.ts';
import { SQLiteStore, type RunStatus, type Store } from '../src/store.js';
import { arrayify, firstStrict } from '../src/utils.js';

type RouteMap<T = unknown> = {
  [P in keyof paths]: {
    [M in RequiredKeysOf<paths[P]> as Extract<M, HttpMethod>]: T;
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

export async function createFixtureWithRuns(opt?: {
  role?: 'participant';
}): Promise<FixtureWithRuns<'participant'>>;
export async function createFixtureWithRuns(opt: {
  role: 'host';
}): Promise<FixtureWithRuns<'host'>>;
export async function createFixtureWithRuns({
  role = 'participant',
}: { role?: 'participant' | 'host' } = {}): Promise<
  FixtureWithRuns<'participant' | 'host'>
> {
  let runs: Array<Run> = [];
  const sessionStore = new MockSessionStore();
  const store = createMockStore();
  const server = LogServer({
    store,
    sessionStore,
    sessionKeys: ['secret'],
    hostPassword: 'host password',
    hostUser: 'host user',
    secureCookies: false,
  });
  const app = express();
  app.use(server.middleware);
  const api = supertest.agent(app).host('lightmill-test.com');
  await api
    .post('/sessions')
    .auth('host user', 'host password')
    .set('Content-Type', apiMediaType)
    .send({ data: { type: 'sessions', attributes: { role } } })
    .expect(201);
  const experiments = await store.getExperiments();
  sessionStore.get.mockImplementation((sid, cb) => {
    cb(null, {
      data: { role, runs: runs.map((r) => r.runId) },
      cookie: { originalMaxAge: 0 },
    });
  });
  store.getRuns.mockImplementation(async (filter) => {
    return runs.filter(
      (r) => filter?.runId == null || arrayify(filter.runId).includes(r.runId),
    );
  });
  vi.clearAllMocks();
  return {
    api,
    sessionStore,
    store,
    experiment: firstStrict(experiments).experimentId,
    setRuns: (newRuns: Array<Run>) => {
      runs = newRuns;
    },
    getRuns: () => runs,
    role,
  };
}

type Run = {
  runId: string;
  runName: string;
  experimentId: string;
  runStatus: RunStatus;
  runCreatedAt: Date;
};
export type FixtureWithRuns<Role extends string = 'participant'> = {
  experiment: string;
  api: supertest.Agent;
  store: MockStore;
  sessionStore: MockSessionStore;
  setRuns: (run: Run[]) => void;
  getRuns: () => Run[];
  role: Role;
};

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

const baseServerOptions = { sessionKeys: ['secret'], secureCookies: false };

type ServerOptions = { hostPassword?: string; hostUser?: string };
async function createServerFromStores<
  DataStore extends Store,
  ThisSessionStore extends SessionStore,
  ServerType extends string,
>({
  store,
  sessionStore,
  type,
  serverOptions,
}: {
  store: DataStore;
  sessionStore: ThisSessionStore;
  type: ServerType;
  serverOptions?: ServerOptions;
}) {
  if (store instanceof SQLiteStore) {
    await store.migrateDatabase();
  }
  return {
    server: LogServer({
      store,
      sessionStore,
      ...baseServerOptions,
      ...serverOptions,
    }),
    store,
    sessionStore,
    type,
  };
}

export const storeTypes = ['sqlite', 'mock'] as const;
export type StoreType = (typeof storeTypes)[number];
const storesCreators = {
  async sqlite() {
    const store = new SQLiteStore(':memory:');
    await store.migrateDatabase();
    const sessionStore = new MemoryStore();
    return { store, sessionStore };
  },
  async mock() {
    const store = createMockStore();
    const sessionStore = new MockSessionStore();
    return { store, sessionStore };
  },
} satisfies Record<StoreType, unknown>;

type StoreCreatorsMap = typeof storesCreators;
export type ServerFromStores<
  DataStore extends Store,
  ThisSessionStore extends SessionStore,
  ServerType extends string,
> = Awaited<
  ReturnType<
    typeof createServerFromStores<DataStore, ThisSessionStore, ServerType>
  >
>;
export type ServerFromDefaultTypes<Type extends StoreType> =
  Awaited<ReturnType<StoreCreatorsMap[Type]>> extends {
    store: infer DataStore extends Store;
    sessionStore: infer ThisSessionStore extends SessionStore;
  }
    ? ServerFromStores<DataStore, ThisSessionStore, Type>
    : never;

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
export async function createServer<Type extends StoreType>(
  options: { type: Type } & CreateServerBaseOptions,
): Promise<ServerFromDefaultTypes<Type>>;
export async function createServer<
  DataStore extends Store,
  ThisSessionStore extends SessionStore,
  ServerType extends `custom${string}`,
>(
  options: {
    store: Store;
    sessionStore: SessionStore;
    type: ServerType;
  } & CreateServerBaseOptions,
): Promise<ServerFromStores<DataStore, ThisSessionStore, ServerType>>;
export async function createServer<
  DataStore extends Store,
  ThisSessionStore extends SessionStore,
>(
  options: {
    store: Store;
    sessionStore: SessionStore;
  } & CreateServerBaseOptions,
): Promise<ServerFromStores<DataStore, ThisSessionStore, 'custom'>>;
export async function createServer(
  options: (
    | { store: Store; sessionStore: SessionStore; type?: `custom${string}` }
    | { type: 'mock' | 'sqlite' }
  ) &
    CreateServerBaseOptions,
) {
  if (isDefaultServerTypeOptions(options)) {
    const { store, sessionStore } = await storesCreators[options.type]();
    return createServerFromStores({ ...options, store, sessionStore });
  }
  return createServerFromStores({ type: 'custom', ...options });
}

export type App = Parameters<typeof request.agent>[0];

type Role = 'host' | 'participant';
type StoreContextMap = {
  sqlite: { store: SQLiteStore; sessionStore: MemoryStore };
  mock: { store: MockStore; sessionStore: MockSessionStore };
};
type SessionFixtureContext<
  R extends Role = Role,
  T extends StoreType = StoreType,
> = { api: request.Agent; role: R; type: T } & StoreContextMap[T];
type SessionFixture<R extends Role, T extends StoreType = StoreType> = {
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
  let serverBag = await createServer({ type });
  let app = express().use(serverBag.server.middleware);
  let api = request.agent(app).host('lightmill-test.com');
  // This request only matters to get the cookie. After that we'll mock the session anyway.
  await api
    .post('/sessions')
    .set('Content-Type', apiMediaType)
    .send({ data: { type: 'sessions', attributes: { role } } })
    .expect(201);
  vi.clearAllMocks();
  return { ...serverBag, api, role };
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
    // @ts-expect-error I don't care about TS here.
    return options.setup[options.storeType](context);
  };
  return test.extend({
    session: async ({}, use) => {
      const context = await createSessionFixtureContext({
        role: options.sessionType,
        type: options.storeType,
      });
      // @ts-expect-error I don't care about TS here.
      const patch = await setupFn(context);
      await use({ ...context, ...patch });
    },
  });
}
