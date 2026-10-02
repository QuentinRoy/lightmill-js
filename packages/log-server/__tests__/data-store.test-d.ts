import { expectTypeOf, it } from 'vitest';
import type { DataStore, DataStoreTransaction } from '../src/index.ts';

it('has no write method on the store itself', () => {
  expectTypeOf<DataStore>().not.toHaveProperty('addExperiment');
  expectTypeOf<DataStore>().not.toHaveProperty('addRun');
  expectTypeOf<DataStore>().not.toHaveProperty('setRunStatus');
  expectTypeOf<DataStore>().not.toHaveProperty('cancelLogsAfter');
  expectTypeOf<DataStore>().not.toHaveProperty('addLogs');
});

it('has no lifetime or nesting on a transaction', () => {
  expectTypeOf<DataStoreTransaction>().not.toHaveProperty('close');
  expectTypeOf<DataStoreTransaction>().not.toHaveProperty('withTransaction');
  expectTypeOf<DataStoreTransaction>().not.toHaveProperty(Symbol.asyncDispose);
});

it('is disposable', () => {
  expectTypeOf<DataStore>().toExtend<AsyncDisposable>();
});
