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

describe('SQLiteStore#getLogValueNames', () => {
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
          date: new Date(1237),
          type: 'other-log',
          values: { x: 12, foo: false },
        },
        {
          date: new Date(1236),
          type: 'log',
          values: { message: 'hola' },
        },
      ]),
    ).resolves.toBeUndefined();
  });
});

describe('SQLiteStore#getLogValueNames', () => {
  let store: SQLiteStore;
  beforeEach(async () => {
    store = new SQLiteStore(':memory:');
    await store.migrateDatabase();
    await store.addRun({
      runId: 'run1',
      experimentId: 'experiment1',
      createdAt: new Date(1234),
    });
    await store.addRun({
      runId: 'run2',
      experimentId: 'experiment1',
      createdAt: new Date(4321),
    });
    await store.addRun({
      runId: 'run1',
      experimentId: 'experiment2',
      createdAt: new Date(1234),
    });
    await store.addLogs('experiment1', 'run1', [
      {
        date: new Date(1234),
        type: 'log1',
        values: { message: 'hello', recipient: 'Anna' },
      },
      {
        date: new Date(1236),
        type: 'log1',
        values: { message: 'bonjour', recipient: 'Jo' },
      },
    ]);
    await store.addLogs('experiment1', 'run2', [
      {
        date: new Date(1235),
        type: 'log2',
        values: { x: 12, foo: false },
      },
      {
        date: new Date(1237),
        type: 'log1',
        values: { message: 'hola', bar: null },
      },
    ]);
    await store.addLogs('experiment2', 'run1', [
      {
        date: new Date(1240),
        type: 'log2',
        values: { x: 25, y: 0, foo: true },
      },
    ]);
  });
  afterEach(async () => {
    await store.close();
  });

  it('should return the names of all log values in alphabetical order', async () => {
    await expect(store.getLogValueNames()).resolves.toEqual([
      'bar',
      'foo',
      'message',
      'recipient',
      'x',
      'y',
    ]);
  });
  it('should be able to filter logs of a particular type', async () => {
    await expect(store.getLogValueNames({ type: 'log1' })).resolves.toEqual([
      'bar',
      'message',
      'recipient',
    ]);
    await expect(store.getLogValueNames({ type: 'log2' })).resolves.toEqual([
      'foo',
      'x',
      'y',
    ]);
  });
  it('should be able to filter logs from a particular experiment', async () => {
    await expect(
      store.getLogValueNames({ experiment: 'experiment1' }),
    ).resolves.toEqual(['bar', 'foo', 'message', 'recipient', 'x']);
    await expect(
      store.getLogValueNames({ experiment: 'experiment2' }),
    ).resolves.toEqual(['foo', 'x', 'y']);
  });
  it('should be able to filter logs from a particular run', async () => {
    await expect(store.getLogValueNames({ run: 'run1' })).resolves.toEqual([
      'foo',
      'message',
      'recipient',
      'x',
      'y',
    ]);
    await expect(store.getLogValueNames({ run: 'run2' })).resolves.toEqual([
      'bar',
      'foo',
      'message',
      'x',
    ]);
  });
  it('should be able to filter logs by run, experiment, and type all at once', async () => {
    await expect(
      store.getLogValueNames({ experiment: 'experiment1', type: 'log2' }),
    ).resolves.toEqual(['foo', 'x']);
    await expect(
      store.getLogValueNames({
        experiment: 'experiment1',
        type: 'log1',
        run: 'run1',
      }),
    ).resolves.toEqual(['message', 'recipient']);
  });
  it('should resolve with an empty array if no log matches the filter', async () => {
    await expect(
      store.getLogValueNames({ experiment: 'experiment2', type: 'log1' }),
    ).resolves.toEqual([]);
    await expect(
      store.getLogValueNames({ experiment: 'do not exist' }),
    ).resolves.toEqual([]);
    await expect(
      store.getLogValueNames({ run: 'do not exist' }),
    ).resolves.toEqual([]);
    await expect(
      store.getLogValueNames({ type: 'do not exist' }),
    ).resolves.toEqual([]);
  });
});
