import {
  type MockInstance,
  afterEach,
  beforeEach,
  describe,
  it,
  vi,
} from 'vitest';
import loglevel from 'loglevel';
// These tests must run on the compiled code, not the source code, because
// kysely does not support typescript migration files.
import { SQLiteStore } from '../dist/store.js';
import type { RunId } from '../src/store.js';

// Prevent kysely from logging anything.
loglevel.setDefaultLevel('silent');

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SQLiteStore', () => {
  it('should create and close a new Store instance without error', async () => {
    let store = new SQLiteStore(':memory:');
    await store.close();
  });
});

describe('SQLiteStore#migrateDatabase', () => {
  it('should initialize the database without errors', async ({ expect }) => {
    let store = new SQLiteStore(':memory:');
    let resultSet = await store.migrateDatabase();
    if (resultSet.error != null) {
      throw resultSet.error;
    }
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
  let addRunSpy: MockInstance<
    Parameters<SQLiteStore['addRun']>,
    ReturnType<SQLiteStore['addRun']>
  >;
  beforeEach(async () => {
    store = new SQLiteStore(':memory:');
    addRunSpy = vi.spyOn(store, 'addRun');
    await store.migrateDatabase();
  });
  afterEach(async () => {
    await store.close();
  });
  function isAddRunResult(result: unknown): result is { runId: RunId } {
    return isObject(result) && 'runId' in result && result.runId != null;
  }

  it('should create runs with different ids', async ({ expect }) => {
    await expect(
      store.addRun({ runName: 'run1', experimentName: 'experiment1' }),
    ).resolves.toSatisfy(isAddRunResult);
    await expect(
      store.addRun({ runName: 'run2', experimentName: 'experiment1' }),
    ).resolves.toSatisfy(isAddRunResult);
    await expect(
      store.addRun({ runName: 'run3', experimentName: 'experiment2' }),
    ).resolves.toSatisfy(isAddRunResult);
    expect(addRunSpy).toHaveBeenCalledTimes(3);
    expect(Promise.all(addRunSpy.mock.results)).resolves.toSatisfy(
      (runIds): boolean => Array.isArray(runIds) && allUnique(runIds),
    );
  });

  it('should refuse to add a run if a run with the same id already exists for the experiment', async ({
    expect,
  }) => {
    await store.addRun({ runName: 'run1', experimentName: 'experiment1' });
    await expect(
      store.addRun({ runName: 'run1', experimentName: 'experiment1' }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[StoreError: run "run1" already exists for experiment "experiment1".]`,
    );
  });

  it('should add a run if a run with the same id already exists but for a different experiment', async ({
    expect,
  }) => {
    await expect(
      store.addRun({ runName: 'run-id', experimentName: 'experiment1' }),
    ).resolves.toSatisfy(isAddRunResult);
    await expect(
      store.addRun({ runName: 'run-id', experimentName: 'experiment2' }),
    ).resolves.toSatisfy(isAddRunResult);
  });
});

describe('SQLiteStore#getRuns', () => {
  let store: SQLiteStore;
  let runIds: RunId[];
  let unknownRun: RunId;
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime('2021-06-03T00:00:00.000Z');
    store = new SQLiteStore(':memory:');
    runIds = [];
    await store.migrateDatabase();
    let { runId } = await store.addRun({
      runName: 'run1',
      experimentName: 'experiment1',
      runStatus: 'running',
    });
    runIds.push(runId);
    ({ runId } = await store.addRun({
      runName: 'run2',
      experimentName: 'experiment1',
      runStatus: 'idle',
    }));
    runIds.push(runId);
    ({ runId } = await store.addRun({
      runName: 'run1',
      experimentName: 'experiment2',
      runStatus: 'idle',
    }));
    runIds.push(runId);
    unknownRun = 0 as RunId;
    while (runIds.includes(unknownRun)) {
      unknownRun++;
    }
  });
  afterEach(async () => {
    await store.close();
    vi.useRealTimers();
  });

  it('should return the run corresponding to a runId', async ({ expect }) => {
    await expect(store.getRuns({ runId: runIds[0] })).resolves.toEqual([
      {
        runName: 'run1',
        experimentName: 'experiment1',
        runStatus: 'running',
        runCreatedAt: new Date('2021-06-03T00:00:00.000Z'),
        runId: runIds[0],
      },
    ]);
    await expect(store.getRuns({ runId: runIds[1] })).resolves.toEqual([
      {
        runName: 'run2',
        experimentName: 'experiment1',
        runStatus: 'idle',
        runCreatedAt: new Date('2021-06-03T00:00:00.000Z'),
        runId: runIds[1],
      },
    ]);
    await expect(store.getRuns({ runId: runIds[2] })).resolves.toEqual([
      {
        runName: 'run1',
        experimentName: 'experiment2',
        runStatus: 'idle',
        runCreatedAt: new Date('2021-06-03T00:00:00.000Z'),
        runId: runIds[2],
      },
    ]);
  });

  it('should return an empty array if no corresponding runs are found', async ({
    expect,
  }) => {
    await expect(store.getRuns({ runId: unknownRun })).resolves.toEqual([]);
  });

  it('should return all runs if no filter is provided', async ({ expect }) => {
    await expect(store.getRuns()).resolves.toEqual([
      {
        experimentName: 'experiment1',
        runCreatedAt: new Date('2021-06-03T00:00:00.000Z'),
        runId: runIds[0],
        runName: 'run1',
        runStatus: 'running',
      },
      {
        experimentName: 'experiment1',
        runCreatedAt: new Date('2021-06-03T00:00:00.000Z'),
        runId: runIds[1],
        runName: 'run2',
        runStatus: 'idle',
      },
      {
        experimentName: 'experiment2',
        runCreatedAt: new Date('2021-06-03T00:00:00.000Z'),
        runId: runIds[2],
        runName: 'run1',
        runStatus: 'idle',
      },
    ]);
  });

  it('should return all runs corresponding to an experiment name', async ({
    expect,
  }) => {
    await expect(
      store.getRuns({ experimentName: 'experiment2' }),
    ).resolves.toEqual([
      {
        experimentName: 'experiment2',
        runCreatedAt: new Date('2021-06-03T00:00:00.000Z'),
        runId: runIds[2],
        runName: 'run1',
        runStatus: 'idle',
      },
    ]);
    await expect(
      store.getRuns({ experimentName: 'experiment1' }),
    ).resolves.toEqual([
      {
        experimentName: 'experiment1',
        runCreatedAt: new Date('2021-06-03T00:00:00.000Z'),
        runId: runIds[0],
        runName: 'run1',
        runStatus: 'running',
      },
      {
        experimentName: 'experiment1',
        runCreatedAt: new Date('2021-06-03T00:00:00.000Z'),
        runId: runIds[1],
        runName: 'run2',
        runStatus: 'idle',
      },
    ]);
    await expect(
      store.getRuns({ experimentName: ['experiment1', 'experiment2'] }),
    ).resolves.toEqual([
      {
        experimentName: 'experiment1',
        runCreatedAt: new Date('2021-06-03T00:00:00.000Z'),
        runId: runIds[0],
        runName: 'run1',
        runStatus: 'running',
      },
      {
        experimentName: 'experiment1',
        runCreatedAt: new Date('2021-06-03T00:00:00.000Z'),
        runId: runIds[1],
        runName: 'run2',
        runStatus: 'idle',
      },
      {
        experimentName: 'experiment2',
        runCreatedAt: new Date('2021-06-03T00:00:00.000Z'),
        runId: runIds[2],
        runName: 'run1',
        runStatus: 'idle',
      },
    ]);
  });

  it('should return all runs corresponding to a run name', async ({
    expect,
  }) => {
    await expect(store.getRuns({ runName: 'run2' })).resolves.toEqual([
      {
        experimentName: 'experiment1',
        runCreatedAt: new Date('2021-06-03T00:00:00.000Z'),
        runId: runIds[1],
        runName: 'run2',
        runStatus: 'idle',
      },
    ]);
    await expect(store.getRuns({ runName: 'run1' })).resolves.toEqual([
      {
        experimentName: 'experiment1',
        runCreatedAt: new Date('2021-06-03T00:00:00.000Z'),
        runId: runIds[0],
        runName: 'run1',
        runStatus: 'running',
      },
      {
        experimentName: 'experiment2',
        runCreatedAt: new Date('2021-06-03T00:00:00.000Z'),
        runId: runIds[2],
        runName: 'run1',
        runStatus: 'idle',
      },
    ]);
    await expect(store.getRuns({ runName: ['run1', 'run2'] })).resolves.toEqual(
      [
        {
          experimentName: 'experiment1',
          runCreatedAt: new Date('2021-06-03T00:00:00.000Z'),
          runId: runIds[0],
          runName: 'run1',
          runStatus: 'running',
        },
        {
          experimentName: 'experiment1',
          runCreatedAt: new Date('2021-06-03T00:00:00.000Z'),
          runId: runIds[1],
          runName: 'run2',
          runStatus: 'idle',
        },
        {
          experimentName: 'experiment2',
          runCreatedAt: new Date('2021-06-03T00:00:00.000Z'),
          runId: runIds[2],
          runName: 'run1',
          runStatus: 'idle',
        },
      ],
    );
  });

  it('should return all runs with a specific status', async ({ expect }) => {
    await expect(store.getRuns({ runStatus: 'running' })).resolves.toEqual([
      {
        experimentName: 'experiment1',
        runCreatedAt: new Date('2021-06-03T00:00:00.000Z'),
        runId: runIds[0],
        runName: 'run1',
        runStatus: 'running',
      },
    ]);
    await expect(store.getRuns({ runStatus: '-idle' })).resolves.toEqual([
      {
        experimentName: 'experiment1',
        runCreatedAt: new Date('2021-06-03T00:00:00.000Z'),
        runId: runIds[0],
        runName: 'run1',
        runStatus: 'running',
      },
    ]);
    await expect(
      store.getRuns({ runStatus: ['idle', 'completed'] }),
    ).resolves.toEqual([
      {
        experimentName: 'experiment1',
        runCreatedAt: new Date('2021-06-03T00:00:00.000Z'),
        runId: runIds[1],
        runName: 'run2',
        runStatus: 'idle',
      },
      {
        experimentName: 'experiment2',
        runCreatedAt: new Date('2021-06-03T00:00:00.000Z'),
        runId: runIds[2],
        runName: 'run1',
        runStatus: 'idle',
      },
    ]);
    await expect(
      store.getRuns({ runStatus: ['idle', 'running', 'canceled'] }),
    ).resolves.toEqual([
      {
        experimentName: 'experiment1',
        runCreatedAt: new Date('2021-06-03T00:00:00.000Z'),
        runId: runIds[0],
        runName: 'run1',
        runStatus: 'running',
      },
      {
        experimentName: 'experiment1',
        runCreatedAt: new Date('2021-06-03T00:00:00.000Z'),
        runId: runIds[1],
        runName: 'run2',
        runStatus: 'idle',
      },
      {
        experimentName: 'experiment2',
        runCreatedAt: new Date('2021-06-03T00:00:00.000Z'),
        runId: runIds[2],
        runName: 'run1',
        runStatus: 'idle',
      },
    ]);
  });
});

describe('SQLiteStore#setRunStatus', () => {
  let store: SQLiteStore;
  let run1: RunId;
  let run2: RunId;
  let unknownRun: RunId;
  beforeEach(async () => {
    store = new SQLiteStore(':memory:');
    await store.migrateDatabase();
    ({ runId: run1 } = await store.addRun({
      runName: 'run1',
      experimentName: 'experiment',
      runStatus: 'running',
    }));
    ({ runId: run2 } = await store.addRun({
      runName: 'run2',
      experimentName: 'experiment',
      runStatus: 'running',
    }));
    unknownRun = [1, 2, 3, 4].filter(
      (x) => x !== run1 && x !== run2,
    )[0] as RunId;
    await store.addLogs(run1, [
      { type: 'log', number: 1, values: { x: 1 } },
      { type: 'log', number: 2, values: { x: 2 } },
    ]);
  });
  afterEach(async () => {
    await store.close();
  });

  it('should set the status of the run if it exists', async ({ expect }) => {
    await expect(
      store.setRunStatus(run1, 'completed'),
    ).resolves.toBeUndefined();
    await expect(store.setRunStatus(run2, 'canceled')).resolves.toBeUndefined();
  });

  it('should refuse to set an unknown status', async ({ expect }) => {
    await expect(
      store.setRunStatus(run1, 'unknown' as 'completed'),
    ).rejects.toThrow();
  });

  it('should refuse to update a completed run', async ({ expect }) => {
    await store.setRunStatus(run1, 'completed');
    await expect(
      store.setRunStatus(run1, 'completed'),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[StoreError: Cannot update status of run "run1" for experiment "experiment" because the run is completed or canceled]`,
    );
    await expect(
      store.setRunStatus(run1, 'canceled'),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[StoreError: Cannot update status of run "run1" for experiment "experiment" because the run is completed or canceled]`,
    );
  });

  it('should refuse to update a canceled run', async ({ expect }) => {
    await store.setRunStatus(run1, 'canceled');
    await expect(
      store.setRunStatus(run1, 'completed'),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[StoreError: Cannot update status of run "run1" for experiment "experiment" because the run is completed or canceled]`,
    );
    await expect(
      store.setRunStatus(run1, 'canceled'),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[StoreError: Cannot update status of run "run1" for experiment "experiment" because the run is completed or canceled]`,
    );
  });

  it('should be able to complete a resumed run even if it was interrupted', async ({
    expect,
  }) => {
    await store.setRunStatus(run1, 'interrupted');
    await store.resumeRun(run1, { from: 3 });
    await expect(
      store.setRunStatus(run1, 'completed'),
    ).resolves.toBeUndefined();
  });

  it('should be able to cancel a resumed run even if it was interrupted before', async ({
    expect,
  }) => {
    await store.setRunStatus(run1, 'interrupted');
    await store.resumeRun(run1, { from: 2 });
    await expect(store.setRunStatus(run1, 'canceled')).resolves.toBeUndefined();
  });

  it('should throw if the run does not exist', async ({ expect }) => {
    await expect(
      store.setRunStatus(unknownRun, 'completed'),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[StoreError: No run found for id 3]`,
    );
  });
});

describe('SQLiteStore#resumeRun', () => {
  let store: SQLiteStore;
  let runId: RunId;
  beforeEach(async () => {
    store = new SQLiteStore(':memory:');
    await store.migrateDatabase();
    ({ runId } = await store.addRun({
      runName: 'run',
      experimentName: 'exp',
      runStatus: 'running',
    }));
  });
  afterEach(async () => {
    await store.close();
  });

  it('should resume a running run without logs', async ({ expect }) => {
    store.resumeRun(runId, { from: 1 }).catch(console.error);
    await expect(store.resumeRun(runId, { from: 1 })).resolves.toBeUndefined();
  });

  it('should resume a running run with logs', async ({ expect }) => {
    await store.addLogs(runId, [
      { type: 'log', number: 1, values: { x: 1 } },
      { type: 'log', number: 2, values: { x: 2 } },
    ]);
    await expect(store.resumeRun(runId, { from: 3 })).resolves.toBeUndefined();
  });

  it('should resume an interrupted run without logs', async ({ expect }) => {
    await store.setRunStatus(runId, 'interrupted');
    await expect(store.resumeRun(runId, { from: 1 })).resolves.toBeUndefined();
  });

  it('should resume an interrupted run with logs', async ({ expect }) => {
    await store.addLogs(runId, [
      { type: 'log', number: 1, values: { x: 1 } },
      { type: 'log', number: 2, values: { x: 2 } },
    ]);
    await store.setRunStatus(runId, 'interrupted');
    await expect(store.resumeRun(runId, { from: 3 })).resolves.toBeUndefined();
  });

  it('should refuse to resume a completed run', async ({ expect }) => {
    await store.setRunStatus(runId, 'completed');
    await expect(store.resumeRun(runId, { from: 4 })).rejects.toThrow();
  });

  it('should refuse to resume from 0', async ({ expect }) => {
    await expect(
      store.resumeRun(runId, { from: 0 }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[SqliteError: CHECK constraint failed: start > 0]`,
    );
  });

  it('should refuse to resume from any number < 0', async ({ expect }) => {
    await expect(
      store.resumeRun(runId, { from: -5 }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[SqliteError: CHECK constraint failed: start > 0]`,
    );
  });

  it('should refuse to resume if it would leave missing logs just before the resume number', async ({
    expect,
  }) => {
    await store.addLogs(runId, [
      { type: 'log', number: 1, values: { x: 1 } },
      { type: 'log', number: 2, values: { x: 2 } },
    ]);
    await expect(
      store.resumeRun(runId, { from: 4 }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[StoreError: Cannot resume run "run" of experiment "exp" from log number 4 because the minimum is 3.]`,
    );
  });

  it('should refuse to resume if it would leave missing logs in the middle', async ({
    expect,
  }) => {
    await store.addLogs(runId, [
      { type: 'log', number: 1, values: { x: 1 } },
      { type: 'log', number: 2, values: { x: 2 } },
      { type: 'log', number: 6, values: { x: 2 } },
      { type: 'log', number: 7, values: { x: 2 } },
    ]);
    await expect(
      store.resumeRun(runId, { from: 8 }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[StoreError: Cannot resume run "run" of experiment "exp" from log number 8 because the minimum is 3.]`,
    );
  });

  it('should resume a run even if it would overwrite existing logs', async ({
    expect,
  }) => {
    await store.addLogs(runId, [
      { type: 'log', number: 1, values: { x: 1 } },
      { type: 'log', number: 2, values: { x: 2 } },
      { type: 'log', number: 3, values: { x: 2 } },
      { type: 'log', number: 4, values: { x: 2 } },
      { type: 'log', number: 6, values: { x: 2 } },
    ]);
    await expect(store.resumeRun(runId, { from: 3 })).resolves.toBeUndefined();
  });
});

describe('SQLiteStore#addLogs', () => {
  let store: SQLiteStore;
  let exp1run1: RunId;
  let exp1run2: RunId;
  let exp2run1: RunId;
  beforeEach(async () => {
    store = new SQLiteStore(':memory:');
    await store.migrateDatabase();
    ({ runId: exp1run1 } = await store.addRun({
      runName: 'run1',
      experimentName: 'experiment1',
      runStatus: 'running',
    }));
    ({ runId: exp2run1 } = await store.addRun({
      runName: 'run1',
      experimentName: 'experiment2',
      runStatus: 'running',
    }));
    ({ runId: exp1run2 } = await store.addRun({
      runName: 'run2',
      experimentName: 'experiment1',
      runStatus: 'running',
    }));
  });
  afterEach(async () => {
    await store.close();
  });

  it('should add non empty logs without error', async ({ expect }) => {
    await expect(
      store.addLogs(exp1run1, [
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
      store.addLogs(exp2run1, [
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

  it('should add empty logs without error', async ({ expect }) => {
    await expect(
      store.addLogs(exp1run2, [
        { type: 'log', number: 1, values: {} },
        { type: 'log', number: 2, values: {} },
      ]),
    ).resolves.toBeUndefined();
    await expect(
      store.addLogs(exp2run1, [
        { number: 3, type: 'other-log', values: {} },
        { number: 4, type: 'log', values: {} },
      ]),
    ).resolves.toBeUndefined();
  });

  it('should refuse to add two logs with the same number for the same run when added in two different requests', async ({
    expect,
  }) => {
    await store.addLogs(exp1run1, [
      { type: 'log', number: 1, values: { x: 1 } },
      { type: 'log', number: 2, values: { x: 2 } },
      { type: 'log', number: 3, values: { x: 2 } },
    ]);
    await expect(
      store.addLogs(exp1run1, [{ type: 'log', number: 2, values: { x: 3 } }]),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[StoreError: Cannot add log: duplicated log number in the sequence.]`,
    );
    await expect(
      store.addLogs(exp1run1, [
        { type: 'log', number: 3, values: { x: 3 } },
        { type: 'log', number: 4, values: { x: 3 } },
      ]),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[StoreError: Cannot add log: duplicated log number in the sequence.]`,
    );
  });

  it('should refuse to add two logs with the same number for the same run when added in the same requests', async ({
    expect,
  }) => {
    await expect(
      store.addLogs(exp1run1, [
        { type: 'log2', number: 1, values: { x: 3 } },
        { type: 'log1', number: 3, values: { x: 1 } },
        { type: 'log2', number: 4, values: { x: 3 } },
        { type: 'log2', number: 3, values: { x: 3 } },
      ]),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[StoreError: Cannot add log: duplicated log number in the sequence.]`,
    );
    await expect(
      store.addLogs(exp1run1, [
        { type: 'log1', number: 2, values: { x: 1 } },
        { type: 'log2', number: 2, values: { x: 3 } },
      ]),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[StoreError: Cannot add log: duplicated log number in the sequence.]`,
    );
  });

  it('should add logs with the same number as long as they are in different runs', async ({
    expect,
  }) => {
    await expect(
      store.addLogs(exp1run1, [
        { type: 'log', number: 1, values: { x: 1 } },
        { type: 'log', number: 2, values: { x: 2 } },
      ]),
    ).resolves.toBeUndefined();
    await expect(
      store.addLogs(exp2run1, [
        { type: 'log', number: 2, values: { x: 3 } },
        { type: 'log', number: 1, values: { x: 1 } },
      ]),
    ).resolves.toBeUndefined();
    await expect(
      store.addLogs(exp1run2, [
        { type: 'log', number: 2, values: { x: 3 } },
        { type: 'log', number: 1, values: { x: 1 } },
      ]),
    ).resolves.toBeUndefined();
  });

  it('should store non consecutive logs without error', async ({ expect }) => {
    await expect(
      store.addLogs(exp1run1, [
        { type: 'log', number: 1, values: { x: 0 } },
        { type: 'log', number: 3, values: { x: 1 } },
      ]),
    ).resolves.toBeUndefined();
    await expect(
      store.addLogs(exp1run1, [
        { type: 'log', number: 5, values: { x: 2 } },
        { type: 'log', number: 6, values: { x: 3 } },
      ]),
    ).resolves.toBeUndefined();
  });

  it('should fill in missing logs without error', async ({ expect }) => {
    await expect(
      store.addLogs(exp1run1, [
        { type: 'log1', number: 2, values: { x: 0 } },
        { type: 'log1', number: 5, values: { x: 1 } },
        { type: 'log1', number: 9, values: { x: 2 } },
      ]),
    ).resolves.toBeUndefined();
    await expect(
      store.addLogs(exp1run1, [
        { type: 'log4', number: 7, values: { x: 3 } },
        { type: 'log5', number: 3, values: { x: 4 } },
      ]),
    ).resolves.toBeUndefined();
    await expect(
      store.addLogs(exp1run1, [
        { type: 'log4', number: 1, values: { x: 3 } },
        { type: 'log4', number: 8, values: { x: 3 } },
      ]),
    ).resolves.toBeUndefined();
    await expect(
      store.addLogs(exp1run1, [
        { type: 'log4', number: 10, values: { x: 3 } },
        { type: 'log4', number: 6, values: { x: 3 } },
      ]),
    ).resolves.toBeUndefined();
  });

  it('should refuse to add logs with number < 1', async ({ expect }) => {
    await expect(
      store.addLogs(exp1run1, [{ type: 'log4', number: 0, values: { x: 3 } }]),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[SqliteError: Cannot insert log with log_number smaller than its sequence start]`,
    );
    await expect(
      store.addLogs(exp1run1, [{ type: 'log4', number: -1, values: { x: 3 } }]),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[SqliteError: Cannot insert log with log_number smaller than its sequence start]`,
    );
    await expect(
      store.addLogs(exp1run1, [
        { type: 'log4', number: -1, values: { x: 3 } },
        { type: 'log4', number: 1, values: { x: 3 } },
      ]),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[SqliteError: Cannot insert log with log_number smaller than its sequence start]`,
    );
  });

  it('should add logs to a resumed run', async ({ expect }) => {
    await store.addLogs(exp1run1, [
      { type: 'log4', number: 1, values: { x: 1 } },
      { type: 'log4', number: 2, values: { x: 2 } },
      { type: 'log4', number: 3, values: { x: 3 } },
    ]);
    await store.resumeRun(exp1run1, { from: 4 });
    await expect(
      store.addLogs(exp1run1, [
        { type: 'log4', number: 4, values: { x: 3 } },
        { type: 'log4', number: 5, values: { x: 3 } },
        { type: 'log4', number: 6, values: { x: 3 } },
      ]),
    ).resolves.toBeUndefined();
  });

  it('should add logs even if they have the same number as other logs added before resuming', async ({
    expect,
  }) => {
    await store.addLogs(exp1run1, [
      { type: 'log4', number: 1, values: { x: 1 } },
      { type: 'log4', number: 2, values: { x: 2 } },
      { type: 'log4', number: 3, values: { x: 3 } },
    ]);
    await store.resumeRun(exp1run1, { from: 2 });
    await expect(
      store.addLogs(exp1run1, [
        { type: 'log4', number: 2, values: { x: 3 } },
        { type: 'log4', number: 3, values: { x: 3 } },
      ]),
    ).resolves.toBeUndefined();
  });

  it('should add logs to a resumed even if it creates a gap in log numbers', async ({
    expect,
  }) => {
    await store.addLogs(exp1run1, [
      { type: 'log4', number: 1, values: { x: 1 } },
      { type: 'log4', number: 2, values: { x: 2 } },
      { type: 'log4', number: 3, values: { x: 3 } },
    ]);
    await store.resumeRun(exp1run1, { from: 4 });
    await expect(
      store.addLogs(exp1run1, [
        { type: 'log4', number: 7, values: { x: 3 } },
        { type: 'log4', number: 8, values: { x: 3 } },
      ]),
    ).resolves.toBeUndefined();
  });

  it('should refuse to add logs if the run was resumed from a number higher than the log number', async ({
    expect,
  }) => {
    await store.addLogs(exp1run1, [
      { type: 'log4', number: 1, values: { x: 1 } },
      { type: 'log4', number: 2, values: { x: 1 } },
    ]);
    await store.resumeRun(exp1run1, { from: 3 });
    await expect(
      store.addLogs(exp1run1, [
        { type: 'log4', number: 2, values: { x: 3 } },
        { type: 'log4', number: 3, values: { x: 3 } },
        { type: 'log4', number: 4, values: { x: 3 } },
      ]),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[SqliteError: Cannot insert log with log_number smaller than its sequence start]`,
    );
  });
});

describe('SQLiteStore#getLogSummary', () => {
  let store: SQLiteStore;
  let exp1run1: RunId;
  let exp1run2: RunId;
  let exp2run1: RunId;
  let unknownRun: RunId;
  beforeEach(async () => {
    store = new SQLiteStore(':memory:');
    await store.migrateDatabase();
    ({ runId: exp1run1 } = await store.addRun({
      runName: 'run1',
      experimentName: 'experiment1',
      runStatus: 'running',
    }));
    ({ runId: exp1run2 } = await store.addRun({
      runName: 'run2',
      experimentName: 'experiment1',
      runStatus: 'running',
    }));
    ({ runId: exp2run1 } = await store.addRun({
      runName: 'run1',
      experimentName: 'experiment2',
      runStatus: 'running',
    }));
    unknownRun = [1, 2, 3, 4].filter(
      (x) => x !== exp1run1 && x !== exp1run2 && x !== exp2run1,
    )[0] as RunId;

    await store.addLogs(exp1run1, [
      { number: 2, type: 'log1', values: { x: 10 } },
      { number: 3, type: 'log1', values: { x: 11 } },
    ]);
    await store.addLogs(exp1run1, [
      { number: 8, type: 'log1', values: { x: 20 } },
      { number: 5, type: 'log1', values: { x: 21 } },
    ]);
    await store.addLogs(exp1run1, [
      { number: 1, type: 'log2', values: { x: 30 } },
    ]);
    await store.addLogs(exp1run2, [
      { number: 1, type: 'log2', values: { x: 40 } },
      { number: 3, type: 'log1', values: { x: 41 } },
    ]);
    await store.addLogs(exp2run1, [
      { number: 3, type: 'log3', values: { x: 51 } },
      { number: 2, type: 'log2', values: { x: 50 } },
      { number: 5, type: 'log3', values: { x: 52 } },
    ]);
  });
  afterEach(async () => {
    await store.close();
  });

  it('should be able to return a summary for a particular run', async ({
    expect,
  }) => {
    await expect(store.getLogSummary(exp1run1)).resolves.toEqual([
      { type: 'log1', count: 2, pending: 2, lastNumber: 3 },
      { type: 'log2', count: 1, pending: 0, lastNumber: 1 },
    ]);
    await expect(store.getLogSummary(exp1run2)).resolves.toEqual([
      { type: 'log1', count: 0, pending: 1, lastNumber: null },
      { type: 'log2', count: 1, pending: 0, lastNumber: 1 },
    ]);
    await expect(store.getLogSummary(exp2run1)).resolves.toEqual([
      { type: 'log2', count: 0, pending: 1, lastNumber: null },
      { type: 'log3', count: 0, pending: 2, lastNumber: null },
    ]);
  });

  it('should be able to filter logs by type', async ({ expect }) => {
    await expect(
      store.getLogSummary(exp1run1, { type: 'log2' }),
    ).resolves.toEqual([{ type: 'log2', count: 1, pending: 0, lastNumber: 1 }]);
    await expect(
      store.getLogSummary(exp1run2, { type: ['log1', 'log2'] }),
    ).resolves.toEqual([
      { type: 'log1', count: 0, pending: 1, lastNumber: null },
      { type: 'log2', count: 1, pending: 0, lastNumber: 1 },
    ]);
    await expect(
      store.getLogSummary(exp2run1, { type: ['log1', 'log2'] }),
    ).resolves.toEqual([
      { type: 'log2', count: 0, pending: 1, lastNumber: null },
    ]);
  });

  it('should resolve with an empty array if no log matches the filter', async ({
    expect,
  }) => {
    await expect(store.getLogSummary(unknownRun)).resolves.toEqual([]);
    await expect(
      store.getLogSummary(exp1run1, { type: 'do not exist' }),
    ).resolves.toEqual([]);
  });
});

describe('SQLiteStore#getLogValueNames', () => {
  let store: SQLiteStore;
  let exp1run1: RunId;
  let exp1run2: RunId;
  let exp2run1: RunId;
  beforeEach(async () => {
    store = new SQLiteStore(':memory:');
    await store.migrateDatabase();
    exp1run1 = (
      await store.addRun({
        runName: 'run1',
        experimentName: 'experiment1',
        runStatus: 'running',
      })
    ).runId;
    exp1run2 = (
      await store.addRun({
        runName: 'run2',
        experimentName: 'experiment1',
        runStatus: 'running',
      })
    ).runId;
    exp2run1 = (
      await store.addRun({
        runName: 'run1',
        experimentName: 'experiment2',
        runStatus: 'running',
      })
    ).runId;
    await store.addLogs(exp1run1, [
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
    await store.addLogs(exp1run2, [
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
    await store.addLogs(exp2run1, [
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

  it('should return the names of all log values in alphabetical order', async ({
    expect,
  }) => {
    await expect(store.getLogValueNames()).resolves.toEqual([
      'bar',
      'foo',
      'message',
      'recipient',
      'x',
      'y',
    ]);
  });

  it('should be able to filter logs of a particular type', async ({
    expect,
  }) => {
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

  it('should be able to filter logs from a particular experiment', async ({
    expect,
  }) => {
    await expect(
      store.getLogValueNames({ experimentName: 'experiment1' }),
    ).resolves.toEqual(['bar', 'foo', 'message', 'recipient', 'x']);
    await expect(
      store.getLogValueNames({ experimentName: 'experiment2' }),
    ).resolves.toEqual(['foo', 'x', 'y']);
  });

  it('should be able to filter logs from a particular run', async ({
    expect,
  }) => {
    await expect(store.getLogValueNames({ runName: 'run1' })).resolves.toEqual([
      'foo',
      'message',
      'recipient',
      'x',
      'y',
    ]);
    await expect(store.getLogValueNames({ runName: 'run2' })).resolves.toEqual([
      'bar',
      'foo',
      'message',
      'x',
    ]);
  });

  it('should be able to filter logs by run, experiment, and type all at once', async ({
    expect,
  }) => {
    await expect(
      store.getLogValueNames({ experimentName: 'experiment1', type: 'log2' }),
    ).resolves.toEqual(['foo', 'x']);
    await expect(
      store.getLogValueNames({
        experimentName: 'experiment1',
        type: 'log1',
        runName: 'run1',
      }),
    ).resolves.toEqual(['message', 'recipient']);
  });

  it('should resolve with an empty array if no log matches the filter', async ({
    expect,
  }) => {
    await expect(
      store.getLogValueNames({ experimentName: 'experiment2', type: 'log1' }),
    ).resolves.toEqual([]);
    await expect(
      store.getLogValueNames({ experimentName: 'do not exist' }),
    ).resolves.toEqual([]);
    await expect(
      store.getLogValueNames({ runName: 'do not exist' }),
    ).resolves.toEqual([]);
    await expect(
      store.getLogValueNames({ type: 'do not exist' }),
    ).resolves.toEqual([]);
  });
});

for (const limit of [10000, 2]) {
  describe(`SQLiteStore#getLogs (selectQueryLimit: ${limit})`, () => {
    let store: SQLiteStore;
    let exp1Run1Id: RunId;
    let exp1Run2Id: RunId;
    let exp2Run1Id: RunId;
    beforeEach(async () => {
      store = new SQLiteStore(':memory:', { selectQueryLimit: limit });
      await store.migrateDatabase();
      ({ runId: exp1Run1Id } = await store.addRun({
        runName: 'run1',
        experimentName: 'experiment1',
        runStatus: 'running',
      }));
      ({ runId: exp1Run2Id } = await store.addRun({
        runName: 'run2',
        experimentName: 'experiment1',
        runStatus: 'running',
      }));
      ({ runId: exp2Run1Id } = await store.addRun({
        runName: 'run1',
        experimentName: 'experiment2',
        runStatus: 'running',
      }));
      await store.addLogs(exp1Run1Id, [
        {
          type: 'log1',
          number: 1,
          values: { msg: 'hello', recipient: 'Anna' },
        },
        {
          type: 'log1',
          number: 2,
          values: { msg: 'bonjour', recipient: 'Jo' },
        },
      ]);
      await store.addLogs(exp1Run2Id, [
        { type: 'log1', number: 1, values: { message: 'hola', bar: null } },
        { type: 'log2', number: 2, values: { x: 12, foo: false } },
      ]);
      await store.addLogs(exp2Run1Id, [
        { type: 'log2', number: 1, values: { x: 25, y: 0, foo: true } },
      ]);
      await store.addLogs(exp1Run1Id, [
        { type: 'log3', number: 3, values: { x: 25, y: 0, foo: true } },
      ]);
    });
    afterEach(async () => {
      await store.close();
    });

    it('should return the logs in order of experimentName, runName, and ascending number', async ({
      expect,
    }) => {
      await expect(fromAsync(store.getLogs())).resolves.toMatchInlineSnapshot(`
        [
          {
            "experimentName": "experiment1",
            "number": 1,
            "runId": 1,
            "runName": "run1",
            "runStatus": "running",
            "type": "log1",
            "values": {
              "msg": "hello",
              "recipient": "Anna",
            },
          },
          {
            "experimentName": "experiment1",
            "number": 2,
            "runId": 1,
            "runName": "run1",
            "runStatus": "running",
            "type": "log1",
            "values": {
              "msg": "bonjour",
              "recipient": "Jo",
            },
          },
          {
            "experimentName": "experiment1",
            "number": 3,
            "runId": 1,
            "runName": "run1",
            "runStatus": "running",
            "type": "log3",
            "values": {
              "foo": true,
              "x": 25,
              "y": 0,
            },
          },
          {
            "experimentName": "experiment1",
            "number": 1,
            "runId": 2,
            "runName": "run2",
            "runStatus": "running",
            "type": "log1",
            "values": {
              "bar": null,
              "message": "hola",
            },
          },
          {
            "experimentName": "experiment1",
            "number": 2,
            "runId": 2,
            "runName": "run2",
            "runStatus": "running",
            "type": "log2",
            "values": {
              "foo": false,
              "x": 12,
            },
          },
          {
            "experimentName": "experiment2",
            "number": 1,
            "runId": 3,
            "runName": "run1",
            "runStatus": "running",
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
    it('should return the logs in order of experimentName, runName, and ascending number', async ({
      expect,
    }) => {
      await expect(fromAsync(store.getLogs())).resolves.toMatchSnapshot();
    });
    it('should ignore missing logs', async ({ expect }) => {
      await store.addLogs(exp2Run1Id, [
        {
          type: 'log1',
          number: 11,
          values: { msg: 'hello', recipient: 'Anna' },
        },
        {
          type: 'log1',
          number: 33,
          values: { msg: 'bonjour', recipient: 'Jo' },
        },
      ]);
      await store.addLogs(exp2Run1Id, [
        {
          type: 'log1',
          number: 22,
          values: { msg: 'hello', recipient: 'Anna' },
        },
        {
          type: 'log1',
          number: 44,
          values: { msg: 'bonjour', recipient: 'Jo' },
        },
      ]);
      await expect(fromAsync(store.getLogs())).resolves.toMatchInlineSnapshot(`
        [
          {
            "experimentName": "experiment1",
            "number": 1,
            "runId": 1,
            "runName": "run1",
            "runStatus": "running",
            "type": "log1",
            "values": {
              "msg": "hello",
              "recipient": "Anna",
            },
          },
          {
            "experimentName": "experiment1",
            "number": 2,
            "runId": 1,
            "runName": "run1",
            "runStatus": "running",
            "type": "log1",
            "values": {
              "msg": "bonjour",
              "recipient": "Jo",
            },
          },
          {
            "experimentName": "experiment1",
            "number": 3,
            "runId": 1,
            "runName": "run1",
            "runStatus": "running",
            "type": "log3",
            "values": {
              "foo": true,
              "x": 25,
              "y": 0,
            },
          },
          {
            "experimentName": "experiment1",
            "number": 1,
            "runId": 2,
            "runName": "run2",
            "runStatus": "running",
            "type": "log1",
            "values": {
              "bar": null,
              "message": "hola",
            },
          },
          {
            "experimentName": "experiment1",
            "number": 2,
            "runId": 2,
            "runName": "run2",
            "runStatus": "running",
            "type": "log2",
            "values": {
              "foo": false,
              "x": 12,
            },
          },
          {
            "experimentName": "experiment2",
            "number": 1,
            "runId": 3,
            "runName": "run1",
            "runStatus": "running",
            "type": "log2",
            "values": {
              "foo": true,
              "x": 25,
              "y": 0,
            },
          },
          {
            "experimentName": "experiment2",
            "number": 11,
            "runId": 3,
            "runName": "run1",
            "runStatus": "running",
            "type": "log1",
            "values": {
              "msg": "hello",
              "recipient": "Anna",
            },
          },
          {
            "experimentName": "experiment2",
            "number": 22,
            "runId": 3,
            "runName": "run1",
            "runStatus": "running",
            "type": "log1",
            "values": {
              "msg": "hello",
              "recipient": "Anna",
            },
          },
          {
            "experimentName": "experiment2",
            "number": 33,
            "runId": 3,
            "runName": "run1",
            "runStatus": "running",
            "type": "log1",
            "values": {
              "msg": "bonjour",
              "recipient": "Jo",
            },
          },
          {
            "experimentName": "experiment2",
            "number": 44,
            "runId": 3,
            "runName": "run1",
            "runStatus": "running",
            "type": "log1",
            "values": {
              "msg": "bonjour",
              "recipient": "Jo",
            },
          },
        ]
      `);
    });
    it('should be able to filter logs of a particular type', async ({
      expect,
    }) => {
      await expect(fromAsync(store.getLogs({ type: 'log1' }))).resolves
        .toMatchInlineSnapshot(`
        [
          {
            "experimentName": "experiment1",
            "number": 1,
            "runId": 1,
            "runName": "run1",
            "runStatus": "running",
            "type": "log1",
            "values": {
              "msg": "hello",
              "recipient": "Anna",
            },
          },
          {
            "experimentName": "experiment1",
            "number": 2,
            "runId": 1,
            "runName": "run1",
            "runStatus": "running",
            "type": "log1",
            "values": {
              "msg": "bonjour",
              "recipient": "Jo",
            },
          },
          {
            "experimentName": "experiment1",
            "number": 1,
            "runId": 2,
            "runName": "run2",
            "runStatus": "running",
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
            "experimentName": "experiment1",
            "number": 2,
            "runId": 2,
            "runName": "run2",
            "runStatus": "running",
            "type": "log2",
            "values": {
              "foo": false,
              "x": 12,
            },
          },
          {
            "experimentName": "experiment2",
            "number": 1,
            "runId": 3,
            "runName": "run1",
            "runStatus": "running",
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
    it('should be able to filter logs from a particular experiment', async ({
      expect,
    }) => {
      await expect(fromAsync(store.getLogs({ experimentName: 'experiment1' })))
        .resolves.toMatchInlineSnapshot(`
        [
          {
            "experimentName": "experiment1",
            "number": 1,
            "runId": 1,
            "runName": "run1",
            "runStatus": "running",
            "type": "log1",
            "values": {
              "msg": "hello",
              "recipient": "Anna",
            },
          },
          {
            "experimentName": "experiment1",
            "number": 2,
            "runId": 1,
            "runName": "run1",
            "runStatus": "running",
            "type": "log1",
            "values": {
              "msg": "bonjour",
              "recipient": "Jo",
            },
          },
          {
            "experimentName": "experiment1",
            "number": 3,
            "runId": 1,
            "runName": "run1",
            "runStatus": "running",
            "type": "log3",
            "values": {
              "foo": true,
              "x": 25,
              "y": 0,
            },
          },
          {
            "experimentName": "experiment1",
            "number": 1,
            "runId": 2,
            "runName": "run2",
            "runStatus": "running",
            "type": "log1",
            "values": {
              "bar": null,
              "message": "hola",
            },
          },
          {
            "experimentName": "experiment1",
            "number": 2,
            "runId": 2,
            "runName": "run2",
            "runStatus": "running",
            "type": "log2",
            "values": {
              "foo": false,
              "x": 12,
            },
          },
        ]
      `);
      await expect(fromAsync(store.getLogs({ experimentName: 'experiment2' })))
        .resolves.toMatchInlineSnapshot(`
        [
          {
            "experimentName": "experiment2",
            "number": 1,
            "runId": 3,
            "runName": "run1",
            "runStatus": "running",
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
    it('should be able to filter logs from a particular run', async ({
      expect,
    }) => {
      await expect(fromAsync(store.getLogs({ runName: 'run1' }))).resolves
        .toMatchInlineSnapshot(`
        [
          {
            "experimentName": "experiment1",
            "number": 1,
            "runId": 1,
            "runName": "run1",
            "runStatus": "running",
            "type": "log1",
            "values": {
              "msg": "hello",
              "recipient": "Anna",
            },
          },
          {
            "experimentName": "experiment1",
            "number": 2,
            "runId": 1,
            "runName": "run1",
            "runStatus": "running",
            "type": "log1",
            "values": {
              "msg": "bonjour",
              "recipient": "Jo",
            },
          },
          {
            "experimentName": "experiment1",
            "number": 3,
            "runId": 1,
            "runName": "run1",
            "runStatus": "running",
            "type": "log3",
            "values": {
              "foo": true,
              "x": 25,
              "y": 0,
            },
          },
          {
            "experimentName": "experiment2",
            "number": 1,
            "runId": 3,
            "runName": "run1",
            "runStatus": "running",
            "type": "log2",
            "values": {
              "foo": true,
              "x": 25,
              "y": 0,
            },
          },
        ]
      `);
      await expect(fromAsync(store.getLogs({ runName: 'run2' }))).resolves
        .toMatchInlineSnapshot(`
        [
          {
            "experimentName": "experiment1",
            "number": 1,
            "runId": 2,
            "runName": "run2",
            "runStatus": "running",
            "type": "log1",
            "values": {
              "bar": null,
              "message": "hola",
            },
          },
          {
            "experimentName": "experiment1",
            "number": 2,
            "runId": 2,
            "runName": "run2",
            "runStatus": "running",
            "type": "log2",
            "values": {
              "foo": false,
              "x": 12,
            },
          },
        ]
      `);
    });
    it('should be able to filter logs by run, experiment, and type all at once', async ({
      expect,
    }) => {
      await expect(
        fromAsync(
          store.getLogs({ experimentName: 'experiment1', type: 'log2' }),
        ),
      ).resolves.toMatchInlineSnapshot(`
        [
          {
            "experimentName": "experiment1",
            "number": 2,
            "runId": 2,
            "runName": "run2",
            "runStatus": "running",
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
          store.getLogs({
            experimentName: 'experiment1',
            type: 'log1',
            runName: 'run1',
          }),
        ),
      ).resolves.toMatchInlineSnapshot(`
        [
          {
            "experimentName": "experiment1",
            "number": 1,
            "runId": 1,
            "runName": "run1",
            "runStatus": "running",
            "type": "log1",
            "values": {
              "msg": "hello",
              "recipient": "Anna",
            },
          },
          {
            "experimentName": "experiment1",
            "number": 2,
            "runId": 1,
            "runName": "run1",
            "runStatus": "running",
            "type": "log1",
            "values": {
              "msg": "bonjour",
              "recipient": "Jo",
            },
          },
        ]
      `);
    });
    it('should resolve with an empty array if no log matches the filter', async ({
      expect,
    }) => {
      await expect(
        fromAsync(
          store.getLogs({ experimentName: 'experiment2', type: 'log1' }),
        ),
      ).resolves.toEqual([]);
      await expect(
        fromAsync(store.getLogs({ experimentName: 'do not exist' })),
      ).resolves.toEqual([]);
      await expect(
        fromAsync(store.getLogs({ runName: 'do not exist' })),
      ).resolves.toEqual([]);
      await expect(
        fromAsync(store.getLogs({ type: 'do not exist' })),
      ).resolves.toEqual([]);
    });
    it('should return logs added after resuming', async ({ expect }) => {
      await store.resumeRun(exp2Run1Id, { from: 2 });
      await store.addLogs(exp2Run1Id, [
        { type: 'log3', number: 2, values: { x: 25, y: 0, foo: true } },
      ]);
      await expect(
        fromAsync(
          store.getLogs({ experimentName: 'experiment2', runName: 'run1' }),
        ),
      ).resolves.toMatchInlineSnapshot(`
        [
          {
            "experimentName": "experiment2",
            "number": 1,
            "runId": 3,
            "runName": "run1",
            "runStatus": "running",
            "type": "log2",
            "values": {
              "foo": true,
              "x": 25,
              "y": 0,
            },
          },
          {
            "experimentName": "experiment2",
            "number": 2,
            "runId": 3,
            "runName": "run1",
            "runStatus": "running",
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
    it('should not return logs canceled from resuming', async ({ expect }) => {
      await store.resumeRun(exp1Run2Id, { from: 2 });
      await expect(
        fromAsync(
          store.getLogs({ experimentName: 'experiment1', runName: 'run2' }),
        ),
      ).resolves.toMatchInlineSnapshot(`
        [
          {
            "experimentName": "experiment1",
            "number": 1,
            "runId": 2,
            "runName": "run2",
            "runStatus": "running",
            "type": "log1",
            "values": {
              "bar": null,
              "message": "hola",
            },
          },
        ]
      `);
      await store.resumeRun(exp1Run2Id, { from: 1 });
      await expect(
        fromAsync(
          store.getLogs({ experimentName: 'experiment1', runName: 'run2' }),
        ),
      ).resolves.toEqual([]);
    });
    it('should return logs overwriting other logs after resuming', async ({
      expect,
    }) => {
      await store.addLogs(exp1Run2Id, [
        { type: 'log1', number: 3, values: { x: 5 } },
        { type: 'log1', number: 4, values: { x: 6 } },
      ]);
      await store.resumeRun(exp1Run2Id, { from: 2 });
      await store.addLogs(exp1Run2Id, [
        { type: 'overwriting', number: 2, values: { x: 1 } },
        { type: 'overwriting', number: 3, values: { x: 2 } },
      ]);
      await expect(
        fromAsync(
          store.getLogs({ experimentName: 'experiment1', runName: 'run2' }),
        ),
      ).resolves.toMatchInlineSnapshot(`
        [
          {
            "experimentName": "experiment1",
            "number": 1,
            "runId": 2,
            "runName": "run2",
            "runStatus": "running",
            "type": "log1",
            "values": {
              "bar": null,
              "message": "hola",
            },
          },
          {
            "experimentName": "experiment1",
            "number": 2,
            "runId": 2,
            "runName": "run2",
            "runStatus": "running",
            "type": "overwriting",
            "values": {
              "x": 1,
            },
          },
          {
            "experimentName": "experiment1",
            "number": 3,
            "runId": 2,
            "runName": "run2",
            "runStatus": "running",
            "type": "overwriting",
            "values": {
              "x": 2,
            },
          },
        ]
      `);
    });
  });
}

async function fromAsync<T, O>(
  iterable: AsyncIterable<T>,
  map: (x: T) => O,
): Promise<O[]>;
async function fromAsync<T>(iterable: AsyncIterable<T>): Promise<T[]>;
async function fromAsync<T, O>(iterable: AsyncIterable<T>, map?: (x: T) => O) {
  let values: (T | O)[] = [];
  for await (let value of iterable) {
    values.push(map == null ? value : map(value));
  }
  return values;
}

function isObject(x: unknown): x is object {
  return typeof x === 'object' && x !== null;
}

function allUnique<T>(values: T[]): boolean {
  return new Set(values).size === values.length;
}
