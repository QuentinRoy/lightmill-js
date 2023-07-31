import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import loglevel from 'loglevel';
// These tests must run on the compiled code, not the source code, because
// kysely does not support typescript migration files.
import { SQLiteStore } from '../dist/store.js';

// Prevent kysely from logging anything.
loglevel.setDefaultLevel('silent');

describe('SQLiteStore', () => {
  it('should create and close a new Store instance without error', async () => {
    let store = new SQLiteStore(':memory:');
    await store.close();
  });
});

describe('SQLiteStore#migrateDatabase', () => {
  it('should initialize the database without errors', async () => {
    let store = new SQLiteStore(':memory:');
    let resultSet = await store.migrateDatabase();
    expect(resultSet.error).toBeUndefined();
    expect(resultSet.results).toBeDefined();
    expect(resultSet.results?.length).toBeGreaterThan(0);
    resultSet.results?.forEach((result) => {
      expect(result.status).toBe('Success');
    });
    await store.close();
  });
});

describe('SQLiteStore#addRun', () => {
  let store: SQLiteStore;
  beforeEach(async () => {
    store = new SQLiteStore(':memory:');
    await store.migrateDatabase();
  });
  afterEach(async () => {
    await store.close();
  });
  it('should add runs with different ids without error', async () => {
    await expect(
      store.addRun({
        runId: 'run1',
        experimentId: 'experiment1',
        createdAt: new Date(),
      }),
    ).resolves.toEqual({ runId: 'run1', experimentId: 'experiment1' });
    await expect(
      store.addRun({
        runId: 'run2',
        experimentId: 'experiment1',
        createdAt: new Date(),
      }),
    ).resolves.toEqual({ runId: 'run2', experimentId: 'experiment1' });
    await expect(
      store.addRun({
        runId: 'run3',
        experimentId: 'experiment2',
        createdAt: new Date(),
      }),
    ).resolves.toEqual({ runId: 'run3', experimentId: 'experiment2' });
  });
  it('should refuse to add a run if a run with the same id already exists for the experiment', async () => {
    await store.addRun({
      runId: 'run1',
      experimentId: 'experiment1',
      createdAt: new Date(),
    });
    await expect(
      store.addRun({
        runId: 'run1',
        experimentId: 'experiment1',
        createdAt: new Date(),
      }),
    ).rejects.toThrow();
  });
  it('should add a run if a run with the same id already exists but for a different experiment', async () => {
    await expect(
      store.addRun({
        runId: 'run-id',
        experimentId: 'experiment1',
        createdAt: new Date(),
      }),
    ).resolves.toEqual({ runId: 'run-id', experimentId: 'experiment1' });
    await expect(
      store.addRun({
        runId: 'run-id',
        experimentId: 'experiment2',
        createdAt: new Date(),
      }),
    ).resolves.toEqual({ runId: 'run-id', experimentId: 'experiment2' });
  });
});

describe('SQLiteStore#getRun', () => {
  let store: SQLiteStore;
  beforeEach(async () => {
    store = new SQLiteStore(':memory:');
    await store.migrateDatabase();
    await store.addRun({
      runId: 'run1',
      experimentId: 'experiment',
      createdAt: new Date(1234),
    });
    await store.addRun({
      runId: 'run2',
      experimentId: 'experiment',
      createdAt: new Date(4321),
    });
  });
  afterEach(async () => {
    await store.close();
  });
  it('should return the run if it exists', async () => {
    await expect(store.getRun('experiment', 'run1')).resolves.toEqual({
      runId: 'run1',
      experimentId: 'experiment',
      createdAt: new Date(1234),
      status: 'running',
    });
  });
  it('should return undefined if the run does not exist', async () => {
    await expect(
      store.getRun('experiment', 'unknown-run'),
    ).resolves.toBeUndefined();
  });
});

describe('SQLiteStore#addLogs', () => {
  let store: SQLiteStore;
  beforeEach(async () => {
    store = new SQLiteStore(':memory:');
    await store.migrateDatabase();
    await store.addRun({
      runId: 'run1',
      experimentId: 'experiment',
      createdAt: new Date(1234),
    });
    await store.addRun({
      runId: 'run2',
      experimentId: 'experiment',
      createdAt: new Date(4321),
    });
  });
  afterEach(async () => {
    await store.close();
  });
  it('should add logs without error', async () => {
    await expect(
      store.addLogs('experiment', 'run1', [
        {
          date: new Date(1234),
          type: 'log',
          values: { message: 'hello', bar: null },
        },
        {
          date: new Date(1235),
          type: 'log',
          values: { message: 'bonjour', recipient: 'Jo' },
        },
      ]),
    ).resolves.toBeUndefined();
    await expect(
      store.addLogs('experiment', 'run2', [
        {
          date: new Date(1234),
          type: 'other-log',
          values: { x: 12, foo: false },
        },
        {
          date: new Date(1235),
          type: 'log',
          values: { message: 'hola' },
        },
      ]),
    ).resolves.toBeUndefined();
  });
});
