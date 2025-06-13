/* eslint-disable @typescript-eslint/no-explicit-any */
import { vi, type Mock } from 'vitest';
import { storeTypeSymbol } from '../src/store-types.ts';
import {
  type AllFilter,
  type LogFilter,
  type RunFilter,
  type RunStatus,
  type Store,
} from '../src/store.ts';

class MockStoreBase implements Store {
  [storeTypeSymbol] = 'mock' as const;

  async addExperiment() {
    return {
      experimentId: '1',
      experimentName: 'addExperiment:experimentName',
      experimentCreatedAt: new Date('2022-11-01T00:00:00Z'),
    };
  }

  async getExperiments() {
    return [
      {
        experimentId: '1',
        experimentName: 'getExperiments:experimentName',
        experimentCreatedAt: new Date('2022-11-01T00:00:00Z'),
      },
    ];
  }

  async addRun() {
    return {
      experimentId: '1',
      runId: '1',
      runName: 'addRun:runName',
      experimentName: 'addRun:experimentName',
      runStatus: 'idle' satisfies RunStatus as RunStatus,
      runCreatedAt: new Date('2022-11-01T00:00:00Z'),
    };
  }

  async resumeRun() {
    throw new Error('Method not implemented.');
  }

  async getRuns(filter: Parameters<Store['getRuns']>[0]) {
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
  }

  async setRunStatus() {}

  async addLogs() {
    return [{ logId: 'l1' }, { logId: 'l2' }];
  }

  async getLogValueNames() {
    return ['mock-col1', 'mock-col2', 'mock-col3'];
  }

  async getLastLogs() {
    return [
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
    ];
  }

  async *getLogs() {
    yield {
      experimentId: 'getLogs:exp-id-1',
      runId: 'getLogs:run-id-1',
      logId: 'getLogs:id-1',
      runStatus: 'running' as const,
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
      runStatus: 'completed' as const,
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
  }

  async getNumberOfPendingLogs() {
    return [{ runId: 'getNumberOfPendingLogs:run-id', count: 0 }];
  }

  async migrateDatabase() {
    return {};
  }

  async close() {}
}

// MockStore is defined from Store, not MockStoreBase, so that
// the type of the methods is preserved, and we can use it to mock
// the methods in tests without losing type information.
export type MockStore = WithMockedMethods<Store>;
export function createMockStore(): MockStore {
  return mockMethods<Store>(new MockStoreBase());
}

function isNoResultFilter<Filter extends LogFilter | RunFilter>(
  filter?: Filter,
) {
  if (filter == null) return false;
  return keys.some((key) => isEmptyArray(filter[key as keyof Filter]));
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

type WithMockedMethods<T extends object> = {
  [K in keyof T]: T[K] extends (...args: never[]) => unknown
    ? Mock<T[K]>
    : T[K];
};
function mockMethods<T extends object>(obj: T): WithMockedMethods<T> {
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

export function isMockStore(store: unknown): store is MockStore {
  return (
    typeof store === 'object' &&
    store != null &&
    storeTypeSymbol in store &&
    store[storeTypeSymbol] === 'mock'
  );
}
