/* eslint-disable @typescript-eslint/no-unused-vars */

import type { paths } from '@lightmill/log-api';
import express from 'express';
import { Store as SessionStore, type SessionData } from 'express-session';
import supertest from 'supertest';
import type { RequiredKeysOf, Simplify, ValueOf } from 'type-fest';
import { vi, type Mock } from 'vitest';
import type { HttpMethod } from '../src/api-utils.js';
import { LogServer } from '../src/app.js';
import type {
  AllFilter,
  Log,
  LogFilter,
  RunFilter,
  RunStatus,
  Store,
} from '../src/store.js';
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

function isEmptyArray(value: unknown): value is [] {
  return Array.isArray(value) && value.length === 0;
}

const keys = [
  'experimentId',
  'experimentName',
  'runId',
  'runName',
  'runStatus',
  'logType',
  'logId',
] satisfies Array<keyof AllFilter>;
function isNoResultFilter<Filter extends LogFilter | RunFilter>(
  filter?: Filter,
) {
  if (filter == null) return false;
  return keys.some((key) => isEmptyArray(filter[key as keyof Filter]));
}

export type MockStore = {
  [K in keyof Store]: Store[K] extends infer C extends (
    ...args: never[]
  ) => unknown
    ? Mock<C>
    : Store[K];
};

export function createMockStore(): MockStore {
  return {
    addExperiment: vi.fn(async () => {
      return {
        experimentId: '1',
        experimentName: 'addExperiment:experimentName',
        experimentCreatedAt: new Date('2022-11-01T00:00:00Z'),
      };
    }),
    getExperiments: vi.fn(async () => {
      return [
        {
          experimentId: '1',
          experimentName: 'getExperiments:experimentName',
          experimentCreatedAt: new Date('2022-11-01T00:00:00Z'),
        },
      ];
    }),
    addRun: vi.fn(async (..._args) => {
      return {
        experimentId: '1',
        runId: '1',
        runName: 'addRun:runName',
        experimentName: 'addRun:experimentName',
        runStatus: 'idle' satisfies RunStatus as RunStatus,
        runCreatedAt: new Date('2022-11-01T00:00:00Z'),
      };
    }),
    resumeRun: vi.fn(async (..._args) => {}),
    getRuns: vi.fn(async (filter) => {
      if (isNoResultFilter(filter)) {
        return [];
      }
      return [
        {
          experimentId: 'exp-id',
          runId: 'run-id',
          runName: 'getRun:runName',
          experimentName: 'getRun:experimentName',
          runCreatedAt: vi.getMockedSystemTime() ?? new Date(),
          runStatus: 'running' satisfies RunStatus as RunStatus,
        },
      ];
    }),
    setRunStatus: vi.fn((..._args) => Promise.resolve()),
    addLogs: vi.fn((..._args) =>
      Promise.resolve([{ logId: 'l1' }, { logId: 'l2' }]),
    ),
    getLogValueNames: vi.fn(() =>
      Promise.resolve(['mock-col1', 'mock-col2', 'mock-col3']),
    ),
    getLastLogs: vi.fn((..._args) =>
      Promise.resolve([
        {
          runId: 'getLastLogs:run-id',
          type: 'getLastLogs:type-1',
          logId: 'getLastLogs:id-1',
          number: 12,
          values: { 'mock-col1': 'log1-mock-value1' },
        },
        {
          runId: 'getLastLogs:run-id',
          type: 'getLastLogs:type-2',
          logId: 'getLastLogs:id-2',
          number: 3,
          values: { 'mock-col2': 'log2-mock-value1' },
        },
      ]),
    ),
    getNumberOfPendingLogs: vi.fn((_filter) => {
      return Promise.resolve([
        { runId: 'getNumberOfPendingLogs:run-id', count: 0 },
      ]);
    }),
    getLogs: vi.fn(async function* (): AsyncGenerator<Log> {
      yield {
        experimentId: 'getLogs:exp-id-1',
        runId: 'getLogs:run-id-1',
        logId: 'getLogs:id-1',
        runStatus: 'running',
        experimentName: 'getLogs:experimentName-1',
        runName: 'getLogs:runName-1',
        type: 'getLogs:type-1',
        number: 1,
        values: {
          'mock-col1': 'log1-mock-value1',
          'mock-col2': 'log1-mock-value2',
        },
      };
      yield {
        experimentId: 'getLogs:exp-id-2',
        runId: 'getLogs:run-id-2',
        logId: 'getLogs:id-2',
        runStatus: 'completed',
        experimentName: 'getLogs:experimentName-2',
        runName: 'getLogs:runName-2',
        type: 'getLogs:type-2',
        number: 2,
        values: {
          'mock-col1': 'log2-mock-value1',
          'mock-col2': 'log2-mock-value2',
          'mock-col3': 'log2-mock-value3',
        },
      };
    }),
    migrateDatabase: vi.fn(async () => {
      return {};
    }),
    close: vi.fn(async () => {}),
  };
}

export class MockSessionStore extends SessionStore {
  data: Map<string, SessionData> = new Map();

  ids = vi.fn((cb: (ids: string[]) => void) => {
    cb(Array.from(this.data.keys()));
  });

  get = vi.fn(
    (sid: string, cb: (err?: Error | null, data?: SessionData) => void) => {
      if (this.data.has(sid)) {
        cb(null, this.data.get(sid));
      } else {
        cb();
      }
    },
  );

  set = vi.fn((sid: string, data: SessionData, cb: (err?: Error) => void) => {
    this.data.set(sid, data);
    cb();
  });

  destroy = vi.fn((sid: string, cb: (err?: Error) => void) => {
    this.data.delete(sid);
    cb();
  });

  mockGetData = (data: SessionData['data']) => {
    this.get.mockImplementation((sid, cb) => {
      cb(null, { data, cookie: { originalMaxAge: 0 } });
    });
  };
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
