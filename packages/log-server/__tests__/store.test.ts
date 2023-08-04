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
      store.addRun({ runId: 'run1', experimentId: 'experiment1' }),
    ).resolves.toEqual({ runId: 'run1', experimentId: 'experiment1' });
    await expect(
      store.addRun({ runId: 'run2', experimentId: 'experiment1' }),
    ).resolves.toEqual({ runId: 'run2', experimentId: 'experiment1' });
    await expect(
      store.addRun({ runId: 'run3', experimentId: 'experiment2' }),
    ).resolves.toEqual({ runId: 'run3', experimentId: 'experiment2' });
  });
  it('should refuse to add a run if a run with the same id already exists for the experiment', async () => {
    await store.addRun({ runId: 'run1', experimentId: 'experiment1' });
    await expect(
      store.addRun({ runId: 'run1', experimentId: 'experiment1' }),
    ).rejects.toThrow();
  });
  it('should add a run if a run with the same id already exists but for a different experiment', async () => {
    await expect(
      store.addRun({ runId: 'run-id', experimentId: 'experiment1' }),
    ).resolves.toEqual({ runId: 'run-id', experimentId: 'experiment1' });
    await expect(
      store.addRun({ runId: 'run-id', experimentId: 'experiment2' }),
    ).resolves.toEqual({ runId: 'run-id', experimentId: 'experiment2' });
  });
});

describe('SQLiteStore#getRun', () => {
  let store: SQLiteStore;
  beforeEach(async () => {
    store = new SQLiteStore(':memory:');
    await store.migrateDatabase();
    await store.addRun({ runId: 'run1', experimentId: 'experiment' });
    await store.addRun({ runId: 'run2', experimentId: 'experiment' });
  });
  afterEach(async () => {
    await store.close();
  });
  it('should return the run if it exists', async () => {
    await expect(store.getRun('experiment', 'run1')).resolves.toEqual({
      runId: 'run1',
      experimentId: 'experiment',
      status: 'running',
    });
  });
  it('should return undefined if the run does not exist', async () => {
    await expect(
      store.getRun('experiment', 'unknown-run'),
    ).resolves.toBeUndefined();
  });
});

describe('SQLiteStore#setRunStatus', () => {
  let store: SQLiteStore;
  beforeEach(async () => {
    store = new SQLiteStore(':memory:');
    await store.migrateDatabase();
    await store.addRun({ runId: 'run1', experimentId: 'experiment' });
    await store.addRun({ runId: 'run2', experimentId: 'experiment' });
    await store.addLogs('experiment', 'run1', [
      { type: 'log', number: 1, values: { x: 1 } },
      { type: 'log', number: 2, values: { x: 2 } },
    ]);
  });
  afterEach(async () => {
    await store.close();
  });
  it('should set the status of the run if it exists', async () => {
    await expect(
      store.setRunStatus('experiment', 'run1', 'completed'),
    ).resolves.toBeUndefined();
    await expect(
      store.setRunStatus('experiment', 'run2', 'canceled'),
    ).resolves.toBeUndefined();
  });
  it('should refuse to update a completed run', async () => {
    await store.setRunStatus('experiment', 'run1', 'completed');
    await expect(
      store.setRunStatus('experiment', 'run1', 'completed'),
    ).rejects.toThrow();
    await expect(
      store.setRunStatus('experiment', 'run1', 'canceled'),
    ).rejects.toThrow();
  });
  it('should refuse to update a canceled run', async () => {
    await store.setRunStatus('experiment', 'run1', 'canceled');
    await expect(
      store.setRunStatus('experiment', 'run1', 'completed'),
    ).rejects.toThrow();
    await expect(
      store.setRunStatus('experiment', 'run1', 'canceled'),
    ).rejects.toThrow();
  });
  it('should be able to complete a resumed run even if it was canceled before', async () => {
    await store.setRunStatus('experiment', 'run1', 'canceled');
    await store.resumeRun({
      experimentId: 'experiment',
      runId: 'run1',
      resumeFrom: 3,
    });
    await expect(
      store.setRunStatus('experiment', 'run1', 'completed'),
    ).resolves.toBeUndefined();
  });
  it('should be able to cancel a resumed run even if it was canceled before', async () => {
    await store.setRunStatus('experiment', 'run1', 'canceled');
    await store.resumeRun({
      experimentId: 'experiment',
      runId: 'run1',
      resumeFrom: 2,
    });
    await expect(
      store.setRunStatus('experiment', 'run1', 'canceled'),
    ).resolves.toBeUndefined();
  });
  it('should throw if the run does not exist', async () => {
    await expect(
      store.setRunStatus('experiment', 'run4', 'completed'),
    ).rejects.toThrow();
  });
});

describe('SQLiteStore#resumeRun', () => {
  let store: SQLiteStore;
  beforeEach(async () => {
    store = new SQLiteStore(':memory:');
    await store.migrateDatabase();
    await store.addRun({ runId: 'run', experimentId: 'exp' });
  });
  afterEach(async () => {
    await store.close();
  });
  it('should resume a running run without logs', async () => {
    await expect(
      store.resumeRun({ experimentId: 'exp', runId: 'run', resumeFrom: 1 }),
    ).resolves.toEqual({ runId: 'run', experimentId: 'exp' });
  });
  it('should resume a running run with logs', async () => {
    await store.addLogs('exp', 'run', [
      { type: 'log', number: 1, values: { x: 1 } },
      { type: 'log', number: 2, values: { x: 2 } },
    ]);
    await expect(
      store.resumeRun({ experimentId: 'exp', runId: 'run', resumeFrom: 3 }),
    ).resolves.toEqual({ runId: 'run', experimentId: 'exp' });
  });
  it('should resume a canceled run without logs', async () => {
    await store.setRunStatus('exp', 'run', 'canceled');
    await expect(
      store.resumeRun({ experimentId: 'exp', runId: 'run', resumeFrom: 1 }),
    ).resolves.toEqual({ runId: 'run', experimentId: 'exp' });
  });
  it('should resume a canceled run with logs', async () => {
    await store.addLogs('exp', 'run', [
      { type: 'log', number: 1, values: { x: 1 } },
      { type: 'log', number: 2, values: { x: 2 } },
    ]);
    await store.setRunStatus('exp', 'run', 'canceled');
    await expect(
      store.resumeRun({ experimentId: 'exp', runId: 'run', resumeFrom: 3 }),
    ).resolves.toEqual({ runId: 'run', experimentId: 'exp' });
  });
  it('should refuse to resume a completed run', async () => {
    await store.setRunStatus('exp', 'run', 'completed');
    await expect(
      store.resumeRun({ experimentId: 'exp', runId: 'run', resumeFrom: 4 }),
    ).rejects.toThrow();
  });
  it('should refuse to resume from 0', async () => {
    await expect(
      store.resumeRun({ experimentId: 'exp', runId: 'run', resumeFrom: 0 }),
    ).rejects.toThrow();
  });
  it('should refuse to resume from any number < 0', async () => {
    await expect(
      store.resumeRun({ experimentId: 'exp', runId: 'run', resumeFrom: -5 }),
    ).rejects.toThrow();
  });
  it('should refuse to resume if it would leave missing logs just before the resume number', async () => {
    await store.addLogs('exp', 'run', [
      { type: 'log', number: 1, values: { x: 1 } },
      { type: 'log', number: 2, values: { x: 2 } },
    ]);
    await expect(
      store.resumeRun({ experimentId: 'exp', runId: 'run', resumeFrom: 4 }),
    ).rejects.toThrow();
  });
  it('should refuse to resume if it would leave missing logs in the middle', async () => {
    await store.addLogs('exp', 'run', [
      { type: 'log', number: 1, values: { x: 1 } },
      { type: 'log', number: 2, values: { x: 2 } },
      { type: 'log', number: 6, values: { x: 2 } },
      { type: 'log', number: 7, values: { x: 2 } },
    ]);
    await expect(
      store.resumeRun({ experimentId: 'exp', runId: 'run', resumeFrom: 8 }),
    ).rejects.toThrow();
  });
  it('should resume a run even if it would overwrite existing logs', async () => {
    await store.addLogs('exp', 'run', [
      { type: 'log', number: 1, values: { x: 1 } },
      { type: 'log', number: 2, values: { x: 2 } },
      { type: 'log', number: 3, values: { x: 2 } },
      { type: 'log', number: 4, values: { x: 2 } },
      { type: 'log', number: 6, values: { x: 2 } },
    ]);
    await expect(
      store.resumeRun({ experimentId: 'exp', runId: 'run', resumeFrom: 3 }),
    ).resolves.toEqual({ runId: 'run', experimentId: 'exp' });
  });
  it('should resume a run even if it would overwrite every existing logs', async () => {
    await store.addLogs('exp', 'run', [
      { type: 'log', number: 1, values: { x: 1 } },
      { type: 'log', number: 2, values: { x: 2 } },
      { type: 'log', number: 3, values: { x: 2 } },
      { type: 'log', number: 4, values: { x: 2 } },
      { type: 'log', number: 6, values: { x: 2 } },
    ]);
    await expect(
      store.resumeRun({ experimentId: 'exp', runId: 'run', resumeFrom: 1 }),
    ).resolves.toEqual({ runId: 'run', experimentId: 'exp' });
  });
});

describe('SQLiteStore#addLogs', () => {
  let store: SQLiteStore;
  beforeEach(async () => {
    store = new SQLiteStore(':memory:');
    await store.migrateDatabase();
    await store.addRun({ runId: 'run1', experimentId: 'experiment1' });
    await store.addRun({ runId: 'run1', experimentId: 'experiment2' });
    await store.addRun({ runId: 'run2', experimentId: 'experiment1' });
  });
  afterEach(async () => {
    await store.close();
  });
  it('should add non empty logs without error', async () => {
    await expect(
      store.addLogs('experiment1', 'run1', [
        {
          type: 'log',
          number: 1,
          values: { message: 'hello', bar: null },
        },
        {
          type: 'log',
          number: 2,
          values: { message: 'bonjour', recipient: 'Jo' },
        },
      ]),
    ).resolves.toBeUndefined();
    await expect(
      store.addLogs('experiment1', 'run2', [
        {
          number: 3,
          type: 'other-log',
          values: { x: 12, foo: false },
        },
        {
          number: 4,
          type: 'log',
          values: { message: 'hola' },
        },
      ]),
    ).resolves.toBeUndefined();
  });
  it('should add empty logs without error', async () => {
    await expect(
      store.addLogs('experiment1', 'run1', [
        { type: 'log', number: 1, values: {} },
        { type: 'log', number: 2, values: {} },
      ]),
    ).resolves.toBeUndefined();
    await expect(
      store.addLogs('experiment1', 'run2', [
        { number: 3, type: 'other-log', values: {} },
        { number: 4, type: 'log', values: {} },
      ]),
    ).resolves.toBeUndefined();
  });
  it('should refuse to add two logs with the same number for the same run when added in two different requests', async () => {
    await store.addLogs('experiment1', 'run1', [
      { type: 'log', number: 1, values: { x: 1 } },
      { type: 'log', number: 2, values: { x: 2 } },
      { type: 'log', number: 3, values: { x: 2 } },
    ]);
    await expect(
      store.addLogs('experiment1', 'run1', [
        { type: 'log', number: 2, values: { x: 3 } },
      ]),
    ).rejects.toThrow();
    await expect(
      store.addLogs('experiment1', 'run1', [
        { type: 'log', number: 3, values: { x: 3 } },
        { type: 'log', number: 4, values: { x: 3 } },
      ]),
    ).rejects.toThrow();
  });
  it('should refuse to add two logs with the same number for the same run when added in the same requests', async () => {
    await expect(
      store.addLogs('experiment1', 'run1', [
        { type: 'log2', number: 1, values: { x: 3 } },
        { type: 'log1', number: 3, values: { x: 1 } },
        { type: 'log2', number: 4, values: { x: 3 } },
        { type: 'log2', number: 3, values: { x: 3 } },
      ]),
    ).rejects.toThrow();
    await expect(
      store.addLogs('experiment1', 'run1', [
        { type: 'log1', number: 2, values: { x: 1 } },
        { type: 'log2', number: 2, values: { x: 3 } },
      ]),
    ).rejects.toThrow();
  });
  it('should add logs with the same number as long as they are in different runs', async () => {
    await expect(
      store.addLogs('experiment1', 'run1', [
        { type: 'log', number: 1, values: { x: 1 } },
        { type: 'log', number: 2, values: { x: 2 } },
      ]),
    ).resolves.toBeUndefined();
    await expect(
      store.addLogs('experiment1', 'run2', [
        { type: 'log', number: 2, values: { x: 3 } },
        { type: 'log', number: 1, values: { x: 1 } },
      ]),
    ).resolves.toBeUndefined();
    await expect(
      store.addLogs('experiment2', 'run1', [
        { type: 'log', number: 2, values: { x: 3 } },
        { type: 'log', number: 1, values: { x: 1 } },
      ]),
    ).resolves.toBeUndefined();
  });
  it('should store non consecutive logs without error', async () => {
    await expect(
      store.addLogs('experiment1', 'run1', [
        { type: 'log', number: 1, values: { x: 0 } },
        { type: 'log', number: 3, values: { x: 1 } },
      ]),
    ).resolves.toBeUndefined();
    await expect(
      store.addLogs('experiment1', 'run1', [
        { type: 'log', number: 5, values: { x: 2 } },
        { type: 'log', number: 6, values: { x: 3 } },
      ]),
    ).resolves.toBeUndefined();
  });
  it('should fill in missing logs without error', async () => {
    await expect(
      store.addLogs('experiment1', 'run1', [
        { type: 'log1', number: 2, values: { x: 0 } },
        { type: 'log1', number: 5, values: { x: 1 } },
        { type: 'log1', number: 9, values: { x: 2 } },
      ]),
    ).resolves.toBeUndefined();
    await expect(
      store.addLogs('experiment1', 'run1', [
        { type: 'log4', number: 7, values: { x: 3 } },
        { type: 'log5', number: 3, values: { x: 4 } },
      ]),
    ).resolves.toBeUndefined();
    await expect(
      store.addLogs('experiment1', 'run1', [
        { type: 'log4', number: 1, values: { x: 3 } },
        { type: 'log4', number: 8, values: { x: 3 } },
      ]),
    ).resolves.toBeUndefined();
    await expect(
      store.addLogs('experiment1', 'run1', [
        { type: 'log4', number: 10, values: { x: 3 } },
        { type: 'log4', number: 6, values: { x: 3 } },
      ]),
    ).resolves.toBeUndefined();
  });
  it('should refuse to add logs with number < 1', async () => {
    await expect(
      store.addLogs('experiment1', 'run1', [
        { type: 'log4', number: 0, values: { x: 3 } },
      ]),
    ).rejects.toThrow();
    await expect(
      store.addLogs('experiment1', 'run1', [
        { type: 'log4', number: -1, values: { x: 3 } },
      ]),
    ).rejects.toThrow();
    await expect(
      store.addLogs('experiment1', 'run1', [
        { type: 'log4', number: -1, values: { x: 3 } },
        { type: 'log4', number: 1, values: { x: 3 } },
      ]),
    ).rejects.toThrow();
  });
  it('should add logs to a resumed run', async () => {
    await store.addLogs('experiment1', 'run1', [
      { type: 'log4', number: 1, values: { x: 1 } },
      { type: 'log4', number: 2, values: { x: 2 } },
      { type: 'log4', number: 3, values: { x: 3 } },
    ]);
    await store.resumeRun({
      experimentId: 'experiment1',
      runId: 'run1',
      resumeFrom: 4,
    });
    await expect(
      store.addLogs('experiment1', 'run1', [
        { type: 'log4', number: 4, values: { x: 3 } },
        { type: 'log4', number: 5, values: { x: 3 } },
        { type: 'log4', number: 6, values: { x: 3 } },
      ]),
    ).resolves.toBeUndefined();
  });
  it('should add logs even if they have the same number as other logs added before resuming', async () => {
    await store.addLogs('experiment1', 'run1', [
      { type: 'log4', number: 1, values: { x: 1 } },
      { type: 'log4', number: 2, values: { x: 2 } },
      { type: 'log4', number: 3, values: { x: 3 } },
    ]);
    await store.resumeRun({
      experimentId: 'experiment1',
      runId: 'run1',
      resumeFrom: 2,
    });
    await expect(
      store.addLogs('experiment1', 'run1', [
        { type: 'log4', number: 2, values: { x: 3 } },
        { type: 'log4', number: 3, values: { x: 3 } },
      ]),
    ).resolves.toBeUndefined();
  });
  it('should add logs to a resumed even if it creates a gap in log numbers', async () => {
    await store.addLogs('experiment1', 'run1', [
      { type: 'log4', number: 1, values: { x: 1 } },
      { type: 'log4', number: 2, values: { x: 2 } },
      { type: 'log4', number: 3, values: { x: 3 } },
    ]);
    await store.resumeRun({
      experimentId: 'experiment1',
      runId: 'run1',
      resumeFrom: 4,
    });
    await expect(
      store.addLogs('experiment1', 'run1', [
        { type: 'log4', number: 7, values: { x: 3 } },
        { type: 'log4', number: 8, values: { x: 3 } },
      ]),
    ).resolves.toBeUndefined();
  });
  it('should refuse to add logs if the run was resumed from a number higher than the log number', async () => {
    await store.addLogs('experiment1', 'run1', [
      { type: 'log4', number: 1, values: { x: 1 } },
      { type: 'log4', number: 2, values: { x: 1 } },
    ]);
    await store.resumeRun({
      experimentId: 'experiment1',
      runId: 'run1',
      resumeFrom: 3,
    });
    await expect(
      store.addLogs('experiment1', 'run1', [
        { type: 'log4', number: 2, values: { x: 3 } },
        { type: 'log4', number: 3, values: { x: 3 } },
        { type: 'log4', number: 4, values: { x: 3 } },
      ]),
    ).rejects.toThrow();
  });
});

describe('SQLiteStore#getLogSummary', () => {
  let store: SQLiteStore;
  beforeEach(async () => {
    store = new SQLiteStore(':memory:');
    await store.migrateDatabase();
    await store.addRun({
      runId: 'run1',
      experimentId: 'experiment1',
    });
    await store.addRun({
      runId: 'run2',
      experimentId: 'experiment1',
    });
    await store.addRun({
      runId: 'run1',
      experimentId: 'experiment2',
    });
    await store.addLogs('experiment1', 'run1', [
      { number: 2, type: 'log1', values: { x: 10 } },
      { number: 3, type: 'log1', values: { x: 11 } },
    ]);
    await store.addLogs('experiment1', 'run1', [
      { number: 8, type: 'log1', values: { x: 20 } },
      { number: 5, type: 'log1', values: { x: 21 } },
    ]);
    await store.addLogs('experiment1', 'run1', [
      { number: 1, type: 'log2', values: { x: 30 } },
    ]);
    await store.addLogs('experiment1', 'run2', [
      { number: 1, type: 'log2', values: { x: 40 } },
      { number: 3, type: 'log1', values: { x: 41 } },
    ]);
    await store.addLogs('experiment2', 'run1', [
      { number: 3, type: 'log3', values: { x: 51 } },
      { number: 2, type: 'log2', values: { x: 50 } },
      { number: 5, type: 'log3', values: { x: 52 } },
    ]);
  });
  afterEach(async () => {
    await store.close();
  });
  it('should be able to return a summary for a particular run', async () => {
    await expect(
      store.getLogSummary({ experiment: 'experiment1', run: 'run1' }),
    ).resolves.toEqual([
      { type: 'log1', count: 2, pending: 2, lastNumber: 3 },
      { type: 'log2', count: 1, pending: 0, lastNumber: 1 },
    ]);
    await expect(
      store.getLogSummary({ experiment: 'experiment1', run: 'run2' }),
    ).resolves.toEqual([
      { type: 'log1', count: 0, pending: 1, lastNumber: null },
      { type: 'log2', count: 1, pending: 0, lastNumber: 1 },
    ]);
    await expect(
      store.getLogSummary({ experiment: 'experiment2', run: 'run1' }),
    ).resolves.toEqual([
      { type: 'log2', count: 0, pending: 1, lastNumber: null },
      { type: 'log3', count: 0, pending: 2, lastNumber: null },
    ]);
  });
  it('should be able to filter logs by type', async () => {
    await expect(
      store.getLogSummary({
        experiment: 'experiment1',
        run: 'run1',
        type: 'log2',
      }),
    ).resolves.toEqual([{ type: 'log2', count: 1, pending: 0, lastNumber: 1 }]);
    await expect(
      store.getLogSummary({
        experiment: 'experiment1',
        run: 'run2',
        type: ['log1', 'log2'],
      }),
    ).resolves.toEqual([
      { type: 'log1', count: 0, pending: 1, lastNumber: null },
      { type: 'log2', count: 1, pending: 0, lastNumber: 1 },
    ]);
    await expect(
      store.getLogSummary({
        experiment: 'experiment2',
        run: 'run1',
        type: ['log1', 'log2'],
      }),
    ).resolves.toEqual([
      { type: 'log2', count: 0, pending: 1, lastNumber: null },
    ]);
  });
  it('should resolve with an empty array if no log matches the filter', async () => {
    await expect(
      store.getLogSummary({ experiment: 'experiment1', run: 'do not exist' }),
    ).resolves.toEqual([]);
    await expect(
      store.getLogSummary({ experiment: 'do not exist', run: 'run1' }),
    ).resolves.toEqual([]);
    await expect(
      store.getLogSummary({
        experiment: 'experiment1',
        run: 'run1',
        type: 'do not exist',
      }),
    ).resolves.toEqual([]);
  });
});

describe('SQLiteStore#getLogValueNames', () => {
  let store: SQLiteStore;
  beforeEach(async () => {
    store = new SQLiteStore(':memory:');
    await store.migrateDatabase();
    await store.addRun({ runId: 'run1', experimentId: 'experiment1' });
    await store.addRun({ runId: 'run2', experimentId: 'experiment1' });
    await store.addRun({ runId: 'run1', experimentId: 'experiment2' });
    await store.addLogs('experiment1', 'run1', [
      {
        type: 'log1',
        values: { message: 'hello', recipient: 'Anna' },
        number: 1,
      },
      {
        type: 'log1',
        values: { message: 'bonjour', recipient: 'Jo' },
        number: 2,
      },
    ]);
    await store.addLogs('experiment1', 'run2', [
      {
        type: 'log2',
        values: { x: 12, foo: false },
        number: 3,
      },
      {
        type: 'log1',
        values: { message: 'hola', bar: null },
        number: 4,
      },
    ]);
    await store.addLogs('experiment2', 'run1', [
      {
        type: 'log2',
        values: { x: 25, y: 0, foo: true },
        number: 5,
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

describe('SQLiteStore#getLogs', () => {
  let store: SQLiteStore;
  beforeEach(async () => {
    store = new SQLiteStore(':memory:');
    await store.migrateDatabase();
    await store.addRun({ runId: 'run1', experimentId: 'experiment1' });
    await store.addRun({ runId: 'run2', experimentId: 'experiment1' });
    await store.addRun({ runId: 'run1', experimentId: 'experiment2' });
    await store.addLogs('experiment1', 'run1', [
      { type: 'log1', number: 1, values: { msg: 'hello', recipient: 'Anna' } },
      { type: 'log1', number: 2, values: { msg: 'bonjour', recipient: 'Jo' } },
    ]);
    await store.addLogs('experiment1', 'run2', [
      { type: 'log1', number: 1, values: { message: 'hola', bar: null } },
      { type: 'log2', number: 2, values: { x: 12, foo: false } },
    ]);
    await store.addLogs('experiment2', 'run1', [
      { type: 'log2', number: 1, values: { x: 25, y: 0, foo: true } },
    ]);
    await store.addLogs('experiment1', 'run1', [
      { type: 'log3', number: 3, values: { x: 25, y: 0, foo: true } },
    ]);
  });
  afterEach(async () => {
    await store.close();
  });

  it('should return the logs in order of experimentId, runId, and ascending number', async () => {
    await expect(fromAsync(store.getLogs())).resolves.toMatchInlineSnapshot(`
      [
        {
          "experimentId": "experiment1",
          "number": 1,
          "runId": "run1",
          "type": "log1",
          "values": {
            "msg": "hello",
            "recipient": "Anna",
          },
        },
        {
          "experimentId": "experiment1",
          "number": 2,
          "runId": "run1",
          "type": "log1",
          "values": {
            "msg": "bonjour",
            "recipient": "Jo",
          },
        },
        {
          "experimentId": "experiment1",
          "number": 3,
          "runId": "run1",
          "type": "log3",
          "values": {
            "foo": true,
            "x": 25,
            "y": 0,
          },
        },
        {
          "experimentId": "experiment1",
          "number": 1,
          "runId": "run2",
          "type": "log1",
          "values": {
            "bar": null,
            "message": "hola",
          },
        },
        {
          "experimentId": "experiment1",
          "number": 2,
          "runId": "run2",
          "type": "log2",
          "values": {
            "foo": false,
            "x": 12,
          },
        },
        {
          "experimentId": "experiment2",
          "number": 1,
          "runId": "run1",
          "type": "log2",
          "values": {
            "foo": true,
            "x": 25,
            "y": 0,
          },
        },
      ]
    `);
  });
  it('should ignore missing logs', async () => {
    await store.addLogs('experiment2', 'run1', [
      { type: 'log1', number: 11, values: { msg: 'hello', recipient: 'Anna' } },
      { type: 'log1', number: 33, values: { msg: 'bonjour', recipient: 'Jo' } },
    ]);
    await store.addLogs('experiment2', 'run1', [
      { type: 'log1', number: 22, values: { msg: 'hello', recipient: 'Anna' } },
      { type: 'log1', number: 44, values: { msg: 'bonjour', recipient: 'Jo' } },
    ]);
    await expect(fromAsync(store.getLogs())).resolves.toMatchInlineSnapshot(`
      [
        {
          "experimentId": "experiment1",
          "number": 1,
          "runId": "run1",
          "type": "log1",
          "values": {
            "msg": "hello",
            "recipient": "Anna",
          },
        },
        {
          "experimentId": "experiment1",
          "number": 2,
          "runId": "run1",
          "type": "log1",
          "values": {
            "msg": "bonjour",
            "recipient": "Jo",
          },
        },
        {
          "experimentId": "experiment1",
          "number": 3,
          "runId": "run1",
          "type": "log3",
          "values": {
            "foo": true,
            "x": 25,
            "y": 0,
          },
        },
        {
          "experimentId": "experiment1",
          "number": 1,
          "runId": "run2",
          "type": "log1",
          "values": {
            "bar": null,
            "message": "hola",
          },
        },
        {
          "experimentId": "experiment1",
          "number": 2,
          "runId": "run2",
          "type": "log2",
          "values": {
            "foo": false,
            "x": 12,
          },
        },
        {
          "experimentId": "experiment2",
          "number": 1,
          "runId": "run1",
          "type": "log2",
          "values": {
            "foo": true,
            "x": 25,
            "y": 0,
          },
        },
        {
          "experimentId": "experiment2",
          "number": 11,
          "runId": "run1",
          "type": "log1",
          "values": {
            "msg": "hello",
            "recipient": "Anna",
          },
        },
        {
          "experimentId": "experiment2",
          "number": 22,
          "runId": "run1",
          "type": "log1",
          "values": {
            "msg": "hello",
            "recipient": "Anna",
          },
        },
        {
          "experimentId": "experiment2",
          "number": 33,
          "runId": "run1",
          "type": "log1",
          "values": {
            "msg": "bonjour",
            "recipient": "Jo",
          },
        },
        {
          "experimentId": "experiment2",
          "number": 44,
          "runId": "run1",
          "type": "log1",
          "values": {
            "msg": "bonjour",
            "recipient": "Jo",
          },
        },
      ]
    `);
  });
  it('should be able to filter logs of a particular type', async () => {
    await expect(fromAsync(store.getLogs({ type: 'log1' }))).resolves
      .toMatchInlineSnapshot(`
      [
        {
          "experimentId": "experiment1",
          "number": 1,
          "runId": "run1",
          "type": "log1",
          "values": {
            "msg": "hello",
            "recipient": "Anna",
          },
        },
        {
          "experimentId": "experiment1",
          "number": 2,
          "runId": "run1",
          "type": "log1",
          "values": {
            "msg": "bonjour",
            "recipient": "Jo",
          },
        },
        {
          "experimentId": "experiment1",
          "number": 1,
          "runId": "run2",
          "type": "log1",
          "values": {
            "bar": null,
            "message": "hola",
          },
        },
      ]
    `);
    await expect(fromAsync(store.getLogs({ type: 'log2' }))).resolves
      .toMatchInlineSnapshot(`
      [
        {
          "experimentId": "experiment1",
          "number": 2,
          "runId": "run2",
          "type": "log2",
          "values": {
            "foo": false,
            "x": 12,
          },
        },
        {
          "experimentId": "experiment2",
          "number": 1,
          "runId": "run1",
          "type": "log2",
          "values": {
            "foo": true,
            "x": 25,
            "y": 0,
          },
        },
      ]
    `);
  });
  it('should be able to filter logs from a particular experiment', async () => {
    await expect(fromAsync(store.getLogs({ experiment: 'experiment1' })))
      .resolves.toMatchInlineSnapshot(`
      [
        {
          "experimentId": "experiment1",
          "number": 1,
          "runId": "run1",
          "type": "log1",
          "values": {
            "msg": "hello",
            "recipient": "Anna",
          },
        },
        {
          "experimentId": "experiment1",
          "number": 2,
          "runId": "run1",
          "type": "log1",
          "values": {
            "msg": "bonjour",
            "recipient": "Jo",
          },
        },
        {
          "experimentId": "experiment1",
          "number": 3,
          "runId": "run1",
          "type": "log3",
          "values": {
            "foo": true,
            "x": 25,
            "y": 0,
          },
        },
        {
          "experimentId": "experiment1",
          "number": 1,
          "runId": "run2",
          "type": "log1",
          "values": {
            "bar": null,
            "message": "hola",
          },
        },
        {
          "experimentId": "experiment1",
          "number": 2,
          "runId": "run2",
          "type": "log2",
          "values": {
            "foo": false,
            "x": 12,
          },
        },
      ]
    `);
    await expect(fromAsync(store.getLogs({ experiment: 'experiment2' })))
      .resolves.toMatchInlineSnapshot(`
      [
        {
          "experimentId": "experiment2",
          "number": 1,
          "runId": "run1",
          "type": "log2",
          "values": {
            "foo": true,
            "x": 25,
            "y": 0,
          },
        },
      ]
    `);
  });
  it('should be able to filter logs from a particular run', async () => {
    await expect(fromAsync(store.getLogs({ run: 'run1' }))).resolves
      .toMatchInlineSnapshot(`
      [
        {
          "experimentId": "experiment1",
          "number": 1,
          "runId": "run1",
          "type": "log1",
          "values": {
            "msg": "hello",
            "recipient": "Anna",
          },
        },
        {
          "experimentId": "experiment1",
          "number": 2,
          "runId": "run1",
          "type": "log1",
          "values": {
            "msg": "bonjour",
            "recipient": "Jo",
          },
        },
        {
          "experimentId": "experiment1",
          "number": 3,
          "runId": "run1",
          "type": "log3",
          "values": {
            "foo": true,
            "x": 25,
            "y": 0,
          },
        },
        {
          "experimentId": "experiment2",
          "number": 1,
          "runId": "run1",
          "type": "log2",
          "values": {
            "foo": true,
            "x": 25,
            "y": 0,
          },
        },
      ]
    `);
    await expect(fromAsync(store.getLogs({ run: 'run2' }))).resolves
      .toMatchInlineSnapshot(`
      [
        {
          "experimentId": "experiment1",
          "number": 1,
          "runId": "run2",
          "type": "log1",
          "values": {
            "bar": null,
            "message": "hola",
          },
        },
        {
          "experimentId": "experiment1",
          "number": 2,
          "runId": "run2",
          "type": "log2",
          "values": {
            "foo": false,
            "x": 12,
          },
        },
      ]
    `);
  });
  it('should be able to filter logs by run, experiment, and type all at once', async () => {
    await expect(
      fromAsync(store.getLogs({ experiment: 'experiment1', type: 'log2' })),
    ).resolves.toMatchInlineSnapshot(`
      [
        {
          "experimentId": "experiment1",
          "number": 2,
          "runId": "run2",
          "type": "log2",
          "values": {
            "foo": false,
            "x": 12,
          },
        },
      ]
    `);
    await expect(
      fromAsync(
        store.getLogs({ experiment: 'experiment1', type: 'log1', run: 'run1' }),
      ),
    ).resolves.toMatchInlineSnapshot(`
      [
        {
          "experimentId": "experiment1",
          "number": 1,
          "runId": "run1",
          "type": "log1",
          "values": {
            "msg": "hello",
            "recipient": "Anna",
          },
        },
        {
          "experimentId": "experiment1",
          "number": 2,
          "runId": "run1",
          "type": "log1",
          "values": {
            "msg": "bonjour",
            "recipient": "Jo",
          },
        },
      ]
    `);
  });
  it('should resolve with an empty array if no log matches the filter', async () => {
    await expect(
      fromAsync(store.getLogs({ experiment: 'experiment2', type: 'log1' })),
    ).resolves.toEqual([]);
    await expect(
      fromAsync(store.getLogs({ experiment: 'do not exist' })),
    ).resolves.toEqual([]);
    await expect(
      fromAsync(store.getLogs({ run: 'do not exist' })),
    ).resolves.toEqual([]);
    await expect(
      fromAsync(store.getLogs({ type: 'do not exist' })),
    ).resolves.toEqual([]);
  });
  it('should return logs added after resuming', async () => {
    await store.resumeRun({
      experimentId: 'experiment2',
      runId: 'run1',
      resumeFrom: 2,
    });
    await store.addLogs('experiment2', 'run1', [
      { type: 'log3', number: 2, values: { x: 25, y: 0, foo: true } },
    ]);
    await expect(
      fromAsync(store.getLogs({ experiment: 'experiment2', run: 'run1' })),
    ).resolves.toMatchInlineSnapshot(`
      [
        {
          "experimentId": "experiment2",
          "number": 1,
          "runId": "run1",
          "type": "log2",
          "values": {
            "foo": true,
            "x": 25,
            "y": 0,
          },
        },
        {
          "experimentId": "experiment2",
          "number": 2,
          "runId": "run1",
          "type": "log3",
          "values": {
            "foo": true,
            "x": 25,
            "y": 0,
          },
        },
      ]
    `);
  });
  it('should not return logs canceled from resuming', async () => {
    await store.resumeRun({
      experimentId: 'experiment1',
      runId: 'run2',
      resumeFrom: 2,
    });
    await expect(
      fromAsync(store.getLogs({ experiment: 'experiment1', run: 'run2' })),
    ).resolves.toMatchInlineSnapshot(`
      [
        {
          "experimentId": "experiment1",
          "number": 1,
          "runId": "run2",
          "type": "log1",
          "values": {
            "bar": null,
            "message": "hola",
          },
        },
      ]
    `);
    await store.resumeRun({
      experimentId: 'experiment1',
      runId: 'run2',
      resumeFrom: 1,
    });
    await expect(
      fromAsync(store.getLogs({ experiment: 'experiment1', run: 'run2' })),
    ).resolves.toEqual([]);
  });
  it('should return logs overwriting other logs after resuming', async () => {
    await store.addLogs('experiment1', 'run2', [
      { type: 'log1', number: 3, values: { x: 5 } },
      { type: 'log1', number: 4, values: { x: 6 } },
    ]);
    await store.resumeRun({
      experimentId: 'experiment1',
      runId: 'run2',
      resumeFrom: 2,
    });
    await store.addLogs('experiment1', 'run2', [
      { type: 'overwriting', number: 2, values: { x: 1 } },
      { type: 'overwriting', number: 3, values: { x: 2 } },
    ]);
    await expect(
      fromAsync(store.getLogs({ experiment: 'experiment1', run: 'run2' })),
    ).resolves.toMatchInlineSnapshot(`
      [
        {
          "experimentId": "experiment1",
          "number": 1,
          "runId": "run2",
          "type": "log1",
          "values": {
            "bar": null,
            "message": "hola",
          },
        },
        {
          "experimentId": "experiment1",
          "number": 2,
          "runId": "run2",
          "type": "overwriting",
          "values": {
            "x": 1,
          },
        },
        {
          "experimentId": "experiment1",
          "number": 3,
          "runId": "run2",
          "type": "overwriting",
          "values": {
            "x": 2,
          },
        },
      ]
    `);
  });
});

async function fromAsync<T>(iterable: AsyncIterable<T>) {
  let values: T[] = [];
  for await (let value of iterable) {
    values.push(value);
  }
  return values;
}
