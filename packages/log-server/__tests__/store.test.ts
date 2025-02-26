/* eslint-disable no-empty-pattern -- Empty objects are required with vitest's fixtures */

import loglevel from 'loglevel';
import { afterEach, it as baseIt, beforeEach, describe, vi } from 'vitest';
import { type ExperimentId, SQLiteStore, type RunId } from '../src/store.js';

// Prevent kysely from logging anything.
loglevel.setDefaultLevel('silent');

afterEach(() => {
  vi.restoreAllMocks();
});

interface Fixture {
  store: SQLiteStore;
  experiment1: ExperimentId;
  experiment2: ExperimentId;
  experiment3: ExperimentId;
  experiments: [ExperimentId, ExperimentId, ExperimentId];
  e1run1: RunId;
  e1run2: RunId;
  e2run1: RunId;
  runs: [RunId, RunId, RunId];
  runningRuns: [RunId, RunId, RunId];
  runWith2Logs: RunId;
  unknownRun: RunId;
  mockTime: Date;
}

const it = baseIt.extend<Fixture>({
  store: async ({}, use) => {
    let store = new SQLiteStore(':memory:');
    await store.migrateDatabase();
    await use(store);
    store.close();
  },
  experiment1: async ({ store }, use) => {
    const now = new Date('2022-11-01T00:00:00Z');
    vi.useFakeTimers({ now, toFake: ['Date'] });
    let { experimentId } = await store.addExperiment({
      experimentName: 'experiment-1',
    });
    vi.useRealTimers();
    await use(experimentId);
  },
  experiment2: async ({ store }, use) => {
    const now = new Date('2022-11-02T00:00:00Z');
    vi.useFakeTimers({ now, toFake: ['Date'] });
    let { experimentId } = await store.addExperiment({
      experimentName: 'experiment-2',
    });
    vi.useRealTimers();
    await use(experimentId);
  },
  experiment3: async ({ store }, use) => {
    const now = new Date('2022-11-03T00:00:00Z');
    vi.useFakeTimers({ now, toFake: ['Date'] });
    let { experimentId } = await store.addExperiment({
      experimentName: 'experiment-3',
    });
    vi.useRealTimers();
    await use(experimentId);
  },
  experiments: async ({ experiment1, experiment2, experiment3 }, use) => {
    use([experiment1, experiment2, experiment3]);
  },
  e1run1: async ({ store, experiment1 }, use) => {
    vi.useFakeTimers();
    vi.setSystemTime('2023-01-01T00:00:00.000Z');
    let { runId } = await store.addRun({
      runName: 'run1',
      experimentId: experiment1,
      runStatus: 'running',
    });
    vi.useRealTimers();
    await use(runId);
  },
  e1run2: async ({ store, experiment1 }, use) => {
    vi.useFakeTimers();
    vi.setSystemTime('2023-01-01T00:00:00.000Z');
    let { runId } = await store.addRun({
      runName: 'run2',
      experimentId: experiment1,
      runStatus: 'idle',
    });
    vi.useRealTimers();
    await use(runId);
  },
  e2run1: async ({ store, experiment2 }, use) => {
    vi.useFakeTimers();
    vi.setSystemTime('2023-01-01T00:00:00.000Z');
    let { runId } = await store.addRun({
      runName: 'run1',
      experimentId: experiment2,
      runStatus: 'idle',
    });
    vi.useRealTimers();
    await use(runId);
  },
  runs: async ({ e1run1: run1, e1run2: run2, e2run1: run3 }, use) => {
    await use([run1, run2, run3]);
  },
  unknownRun: async ({ store }, use) => {
    let runs = await store.getRuns();
    // Starting at 100 because the probability of a collision is very low
    // since we don't create more than a few runs.
    let i = 100;
    let id = i.toString();
    while (runs.find((run) => run.runId === id) != null) {
      i++;
      id = i.toString();
    }
    await use(id as RunId);
  },
  mockTime: async ({}, use) => {
    const now = new Date('2024-01-01T00:00:00Z');
    vi.useFakeTimers({ now, toFake: ['Date'] });
    await use(now);
    vi.useRealTimers();
  },
  runWith2Logs: async ({ store, experiment3 }, use) => {
    const { runId } = await store.addRun({
      experimentId: experiment3,
      runStatus: 'running',
    });
    await store.addLogs(runId, [
      { type: 'log', number: 1, values: { x: 1 } },
      { type: 'log', number: 2, values: { x: 2 } },
    ]);
    await use(runId);
  },
  runningRuns: async ({ store, runs }, use) => {
    for (const runId of runs) {
      await store.setRunStatus(runId, 'running');
    }
    await use(runs);
  },
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

describe('SQLiteStore#addExperiment', () => {
  it('should create experiments with different names  ', async ({
    expect,
    store,
    mockTime,
  }) => {
    let result = await store.addExperiment({ experimentName: 'experiment-1' });
    expect(result).toMatchObject({
      experimentName: 'experiment-1',
      experimentCreatedAt: mockTime,
    });
    expect(result.experimentId).toBeDefined();
    result = await store.addExperiment({ experimentName: 'experiment-2' });
    expect(result).toMatchObject({
      experimentName: 'experiment-2',
      experimentCreatedAt: mockTime,
    });
    expect(result.experimentId).toBeDefined();
    await expect(() =>
      store.addExperiment({ experimentName: 'experiment-1' }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[StoreError: Experiment experiment-1 already exists]`,
    );
  });
});

describe('SQLiteStore#getExperiments', () => {
  it('get experiments without filter', async ({
    expect,
    store,
    experiment1,
    experiment2,
    experiment3,
  }) => {
    await expect(store.getExperiments()).resolves.toEqual([
      {
        experimentId: experiment1,
        experimentName: 'experiment-1',
        experimentCreatedAt: new Date('2022-11-01T00:00:00.000Z'),
      },
      {
        experimentId: experiment2,
        experimentName: 'experiment-2',
        experimentCreatedAt: new Date('2022-11-02T00:00:00.000Z'),
      },
      {
        experimentId: experiment3,
        experimentName: 'experiment-3',
        experimentCreatedAt: new Date('2022-11-03T00:00:00.000Z'),
      },
    ]);
  });

  it('get experiments with filter on name', async ({
    expect,
    store,
    experiment1,
    experiment2,
    experiment3,
  }) => {
    await expect(
      store.getExperiments({ experimentName: 'experiment-1' }),
    ).resolves.toEqual([
      {
        experimentId: experiment1,
        experimentName: 'experiment-1',
        experimentCreatedAt: new Date('2022-11-01T00:00:00.000Z'),
      },
    ]);

    await expect(
      store.getExperiments({
        experimentName: ['experiment-2', 'experiment-3'],
      }),
    ).resolves.toEqual([
      {
        experimentId: experiment2,
        experimentName: 'experiment-2',
        experimentCreatedAt: new Date('2022-11-02T00:00:00.000Z'),
      },
      {
        experimentId: experiment3,
        experimentName: 'experiment-3',
        experimentCreatedAt: new Date('2022-11-03T00:00:00.000Z'),
      },
    ]);
  });

  it('get experiments with filter on id', async ({
    expect,
    store,
    experiment1,
    // This isn't used, but must be included so the experiment
    // is added.
    experiment2: _,
    experiment3,
  }) => {
    await expect(
      store.getExperiments({ experimentId: experiment1 }),
    ).resolves.toEqual([
      {
        experimentId: experiment1,
        experimentName: 'experiment-1',
        experimentCreatedAt: new Date('2022-11-01T00:00:00.000Z'),
      },
    ]);

    await expect(
      store.getExperiments({ experimentId: [experiment1, experiment3] }),
    ).resolves.toEqual([
      {
        experimentId: experiment1,
        experimentName: 'experiment-1',
        experimentCreatedAt: new Date('2022-11-01T00:00:00.000Z'),
      },
      {
        experimentId: experiment3,
        experimentName: 'experiment-3',
        experimentCreatedAt: new Date('2022-11-03T00:00:00.000Z'),
      },
    ]);
  });

  it('get experiments with filter on id and name', async ({
    expect,
    store,
    experiment1,
    // This isn't used, but must be included so the experiment
    // is added.
    experiment2: _,
    experiment3,
  }) => {
    await expect(
      store.getExperiments({
        experimentId: [experiment1, experiment3],
        experimentName: 'experiment-1',
      }),
    ).resolves.toEqual([
      {
        experimentId: experiment1,
        experimentName: 'experiment-1',
        experimentCreatedAt: new Date('2022-11-01T00:00:00.000Z'),
      },
    ]);
  });
});

describe('SQLiteStore#addRun', () => {
  function isAddRunResult(result: unknown): result is { runId: RunId } {
    return isObject(result) && 'runId' in result && result.runId != null;
  }

  it('should create runs with different ids', async ({
    expect,
    store,
    experiment1,
    experiment2,
  }) => {
    let addRunSpy = vi.spyOn(store, 'addRun');
    await expect(
      store.addRun({ runName: 'run1', experimentId: experiment1 }),
    ).resolves.toSatisfy(isAddRunResult);
    await expect(
      store.addRun({ runName: 'run2', experimentId: experiment1 }),
    ).resolves.toSatisfy(isAddRunResult);
    await expect(
      store.addRun({ runName: 'run3', experimentId: experiment2 }),
    ).resolves.toSatisfy(isAddRunResult);
    expect(addRunSpy).toHaveBeenCalledTimes(3);
    await expect(Promise.all(addRunSpy.mock.results)).resolves.toSatisfy(
      (runs: unknown): boolean => Array.isArray(runs) && allUnique(runs),
    );
  });

  it('should refuse to add a run if a run with the same id already exists for the experiment', async ({
    expect,
    store: store,
    experiment1: experimentId,
  }) => {
    await store.addRun({ runName: 'run-name', experimentId });
    await expect(
      store.addRun({ runName: 'run-name', experimentId }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[StoreError: A run named "run-name" already exists for experiment 1.]`,
    );
  });

  it('should add a run if a run with the same id already exists but for a different experiment', async ({
    expect,
    store: store,
    experiment1,
    experiment2,
  }) => {
    await expect(
      store.addRun({ runName: 'run-id', experimentId: experiment1 }),
    ).resolves.toSatisfy(isAddRunResult);
    await expect(
      store.addRun({ runName: 'run-id', experimentId: experiment2 }),
    ).resolves.toSatisfy(isAddRunResult);
  });

  it('should add runs without specifying a name', async ({
    expect,
    store: store,
    experiment1,
  }) => {
    await expect(
      store.addRun({ experimentId: experiment1 }),
    ).resolves.toSatisfy(isAddRunResult);
    await expect(
      store.addRun({ experimentId: experiment1 }),
    ).resolves.toSatisfy(isAddRunResult);
    await expect(
      store.addRun({ experimentId: experiment1 }),
    ).resolves.toSatisfy(isAddRunResult);
  });
});

describe('SQLiteStore#getRuns', () => {
  it('should return the run corresponding to a runId', async ({
    expect,
    store,
    experiment1,
    experiment2,
    runs,
  }) => {
    await expect(store.getRuns({ runId: runs[0] })).resolves.toEqual([
      {
        runName: 'run1',
        experimentId: experiment1,
        runStatus: 'running',
        runCreatedAt: new Date('2023-01-01T00:00:00.000Z'),
        runId: runs[0],
      },
    ]);
    await expect(store.getRuns({ runId: runs[1] })).resolves.toEqual([
      {
        runName: 'run2',
        experimentId: experiment1,
        runStatus: 'idle',
        runCreatedAt: new Date('2023-01-01T00:00:00.000Z'),
        runId: runs[1],
      },
    ]);
    await expect(store.getRuns({ runId: runs[2] })).resolves.toEqual([
      {
        runName: 'run1',
        experimentId: experiment2,
        runStatus: 'idle',
        runCreatedAt: new Date('2023-01-01T00:00:00.000Z'),
        runId: runs[2],
      },
    ]);
  });

  it('should return an empty array if no corresponding runs are found', async ({
    expect,
    store,
    unknownRun,
  }) => {
    await expect(store.getRuns({ runId: unknownRun })).resolves.toEqual([]);
  });

  it('should return all runs if no filter is provided', async ({
    store,
    experiment1,
    experiment2,
    runs,
    expect,
  }) => {
    await expect(store.getRuns()).resolves.toEqual([
      {
        experimentId: experiment1,
        runCreatedAt: new Date('2023-01-01T00:00:00.000Z'),
        runId: runs[0],
        runName: 'run1',
        runStatus: 'running',
      },
      {
        experimentId: experiment1,
        runCreatedAt: new Date('2023-01-01T00:00:00.000Z'),
        runId: runs[1],
        runName: 'run2',
        runStatus: 'idle',
      },
      {
        experimentId: experiment2,
        runCreatedAt: new Date('2023-01-01T00:00:00.000Z'),
        runId: runs[2],
        runName: 'run1',
        runStatus: 'idle',
      },
    ]);
  });

  it('should return all runs corresponding to an experiment name', async ({
    expect,
    store,
    experiment1,
    experiment2,
    runs,
  }) => {
    await expect(
      store.getRuns({ experimentName: 'experiment-2' }),
    ).resolves.toEqual([
      {
        experimentId: experiment2,
        runCreatedAt: new Date('2023-01-01T00:00:00.000Z'),
        runId: runs[2],
        runName: 'run1',
        runStatus: 'idle',
      },
    ]);
    await expect(
      store.getRuns({ experimentName: 'experiment-1' }),
    ).resolves.toEqual([
      {
        experimentId: experiment1,
        runCreatedAt: new Date('2023-01-01T00:00:00.000Z'),
        runId: runs[0],
        runName: 'run1',
        runStatus: 'running',
      },
      {
        experimentId: experiment1,
        runCreatedAt: new Date('2023-01-01T00:00:00.000Z'),
        runId: runs[1],
        runName: 'run2',
        runStatus: 'idle',
      },
    ]);
    await expect(
      store.getRuns({ experimentName: ['experiment-1', 'experiment-2'] }),
    ).resolves.toEqual([
      {
        experimentId: experiment1,
        runCreatedAt: new Date('2023-01-01T00:00:00.000Z'),
        runId: runs[0],
        runName: 'run1',
        runStatus: 'running',
      },
      {
        experimentId: experiment1,
        runCreatedAt: new Date('2023-01-01T00:00:00.000Z'),
        runId: runs[1],
        runName: 'run2',
        runStatus: 'idle',
      },
      {
        experimentId: experiment2,
        runCreatedAt: new Date('2023-01-01T00:00:00.000Z'),
        runId: runs[2],
        runName: 'run1',
        runStatus: 'idle',
      },
    ]);
  });

  it('should return all runs corresponding to a run name', async ({
    expect,
    store,
    experiment1,
    experiment2,
    runs,
  }) => {
    await expect(store.getRuns({ runName: 'run2' })).resolves.toEqual([
      {
        experimentId: experiment1,
        runCreatedAt: new Date('2023-01-01T00:00:00.000Z'),
        runId: runs[1],
        runName: 'run2',
        runStatus: 'idle',
      },
    ]);
    await expect(store.getRuns({ runName: 'run1' })).resolves.toEqual([
      {
        experimentId: experiment1,
        runCreatedAt: new Date('2023-01-01T00:00:00.000Z'),
        runId: runs[0],
        runName: 'run1',
        runStatus: 'running',
      },
      {
        experimentId: experiment2,
        runCreatedAt: new Date('2023-01-01T00:00:00.000Z'),
        runId: runs[2],
        runName: 'run1',
        runStatus: 'idle',
      },
    ]);
    await expect(store.getRuns({ runName: ['run1', 'run2'] })).resolves.toEqual(
      [
        {
          experimentId: experiment1,
          runCreatedAt: new Date('2023-01-01T00:00:00.000Z'),
          runId: runs[0],
          runName: 'run1',
          runStatus: 'running',
        },
        {
          experimentId: experiment1,
          runCreatedAt: new Date('2023-01-01T00:00:00.000Z'),
          runId: runs[1],
          runName: 'run2',
          runStatus: 'idle',
        },
        {
          experimentId: experiment2,
          runCreatedAt: new Date('2023-01-01T00:00:00.000Z'),
          runId: runs[2],
          runName: 'run1',
          runStatus: 'idle',
        },
      ],
    );
  });

  it('should return all runs with a specific status', async ({
    expect,
    store,
    runs,
    experiment1,
    experiment2,
  }) => {
    await expect(store.getRuns({ runStatus: 'running' })).resolves.toEqual([
      {
        experimentId: experiment1,
        runCreatedAt: new Date('2023-01-01T00:00:00.000Z'),
        runId: runs[0],
        runName: 'run1',
        runStatus: 'running',
      },
    ]);
    await expect(store.getRuns({ runStatus: '-idle' })).resolves.toEqual([
      {
        experimentId: experiment1,
        runCreatedAt: new Date('2023-01-01T00:00:00.000Z'),
        runId: runs[0],
        runName: 'run1',
        runStatus: 'running',
      },
    ]);
    await expect(
      store.getRuns({ runStatus: ['idle', 'completed'] }),
    ).resolves.toEqual([
      {
        experimentId: experiment1,
        runCreatedAt: new Date('2023-01-01T00:00:00.000Z'),
        runId: runs[1],
        runName: 'run2',
        runStatus: 'idle',
      },
      {
        experimentId: experiment2,
        runCreatedAt: new Date('2023-01-01T00:00:00.000Z'),
        runId: runs[2],
        runName: 'run1',
        runStatus: 'idle',
      },
    ]);
    await expect(
      store.getRuns({ runStatus: ['idle', 'running', 'canceled'] }),
    ).resolves.toEqual([
      {
        experimentId: experiment1,
        runCreatedAt: new Date('2023-01-01T00:00:00.000Z'),
        runId: runs[0],
        runName: 'run1',
        runStatus: 'running',
      },
      {
        experimentId: experiment1,
        runCreatedAt: new Date('2023-01-01T00:00:00.000Z'),
        runId: runs[1],
        runName: 'run2',
        runStatus: 'idle',
      },
      {
        experimentId: experiment2,
        runCreatedAt: new Date('2023-01-01T00:00:00.000Z'),
        runId: runs[2],
        runName: 'run1',
        runStatus: 'idle',
      },
    ]);
  });

  it('should return all runs if no filter is provided', async ({
    expect,
    store,
    experiment1,
    experiment2,
    runs,
  }) => {
    await expect(store.getRuns()).resolves.toEqual([
      {
        experimentId: experiment1,
        runCreatedAt: new Date('2023-01-01T00:00:00.000Z'),
        runId: runs[0],
        runName: 'run1',
        runStatus: 'running',
      },
      {
        experimentId: experiment1,
        runCreatedAt: new Date('2023-01-01T00:00:00.000Z'),
        runId: runs[1],
        runName: 'run2',
        runStatus: 'idle',
      },
      {
        experimentId: experiment2,
        runCreatedAt: new Date('2023-01-01T00:00:00.000Z'),
        runId: runs[2],
        runName: 'run1',
        runStatus: 'idle',
      },
    ]);
  });

  it('should return an empty array if part of the first is an empty array', async ({
    expect,
    store,
    experiment1,
    runs: _r,
  }) => {
    // Check that the runs are actually created first (vitest fixtures can be a bit tricky, e.g.
    // if comments are added in the test arguments, I've had issues).
    await expect(store.getRuns()).resolves.toHaveLength(3);
    await expect(store.getRuns({ runStatus: [] })).resolves.toEqual([]);
    await expect(store.getRuns({ runName: [] })).resolves.toEqual([]);
    await expect(store.getRuns({ experimentName: [] })).resolves.toEqual([]);
    await expect(store.getRuns({ runId: [] })).resolves.toEqual([]);
    await expect(
      store.getRuns({ experimentName: [], runStatus: 'completed' }),
    ).resolves.toEqual([]);
    await expect(
      store.getRuns({ experimentName: [], runStatus: ['idle', 'completed'] }),
    ).resolves.toEqual([]);
    await expect(
      store.getRuns({ runName: [], runStatus: ['running', 'completed'] }),
    ).resolves.toEqual([]);
    await expect(
      store.getRuns({
        runName: [],
        experimentId: experiment1,
        runStatus: 'completed',
      }),
    ).resolves.toEqual([]);
  });
});

describe('SQLiteStore#setRunStatus', () => {
  it('should set the status of the run if it exists', async ({
    expect,
    store,
    runs,
  }) => {
    await expect(
      store.setRunStatus(runs[0], 'completed'),
    ).resolves.toBeUndefined();
    await expect(
      store.setRunStatus(runs[1], 'canceled'),
    ).resolves.toBeUndefined();
  });

  it('should refuse to set an unknown status', async ({
    expect,
    store,
    runWith2Logs: runId,
  }) => {
    // @ts-expect-error we are intentionally setting an unknown status
    await expect(store.setRunStatus(runId, 'unknown')).rejects.toThrow();
  });

  it('should refuse to update a completed run', async ({
    expect,
    store,
    runWith2Logs: runId,
  }) => {
    await store.setRunStatus(runId, 'completed');
    await expect(
      store.setRunStatus(runId, 'completed'),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[StoreError: Cannot update status of run 1 because the run is completed or canceled]`,
    );
    await expect(
      store.setRunStatus(runId, 'canceled'),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[StoreError: Cannot update status of run 1 because the run is completed or canceled]`,
    );
  });

  it('should refuse to update a canceled run', async ({
    expect,
    store,
    runWith2Logs: runId,
  }) => {
    await store.setRunStatus(runId, 'canceled');
    await expect(
      store.setRunStatus(runId, 'completed'),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[StoreError: Cannot update status of run 1 because the run is completed or canceled]`,
    );
    await expect(
      store.setRunStatus(runId, 'canceled'),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[StoreError: Cannot update status of run 1 because the run is completed or canceled]`,
    );
  });

  it('should be able to complete a resumed run even if it was interrupted', async ({
    expect,
    store,
    runWith2Logs: runId,
  }) => {
    await store.setRunStatus(runId, 'interrupted');
    await store.resumeRun(runId, { from: 3 });
    await expect(
      store.setRunStatus(runId, 'completed'),
    ).resolves.toBeUndefined();
  });

  it('should be able to cancel a resumed run even if it was interrupted before', async ({
    expect,
    store,
    runWith2Logs: runId,
  }) => {
    await store.setRunStatus(runId, 'interrupted');
    await store.resumeRun(runId, { from: 2 });
    await expect(
      store.setRunStatus(runId, 'canceled'),
    ).resolves.toBeUndefined();
  });

  it('should throw if the run does not exist', async ({
    expect,
    store,
    unknownRun,
  }) => {
    await expect(
      store.setRunStatus(unknownRun, 'completed'),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[StoreError: No run found for id 100]`,
    );
  });
});

describe('SQLiteStore#resumeRun', () => {
  it('should resume a running run without logs', async ({
    expect,
    store,
    e1run1: run1,
  }) => {
    await expect(store.resumeRun(run1, { from: 1 })).resolves.toBeUndefined();
  });

  it('should resume a running run with logs', async ({
    expect,
    store,
    runWith2Logs: runId,
  }) => {
    await expect(store.resumeRun(runId, { from: 3 })).resolves.toBeUndefined();
  });

  it('should resume an interrupted run without logs', async ({
    expect,
    store,
    e1run1: run1,
  }) => {
    await store.setRunStatus(run1, 'interrupted');
    await expect(store.resumeRun(run1, { from: 1 })).resolves.toBeUndefined();
  });

  it('should resume an interrupted run with logs', async ({
    expect,
    store,
    runWith2Logs: runId,
  }) => {
    await store.setRunStatus(runId, 'interrupted');
    await expect(store.resumeRun(runId, { from: 3 })).resolves.toBeUndefined();
  });

  it('should refuse to resume a completed run', async ({
    expect,
    store,
    runWith2Logs: runId,
  }) => {
    await store.setRunStatus(runId, 'completed');
    await expect(store.resumeRun(runId, { from: 3 })).rejects.toThrow();
  });

  it('should refuse to resume from 0', async ({
    expect,
    store,
    runWith2Logs: runId,
  }) => {
    await expect(
      store.resumeRun(runId, { from: 0 }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[SqliteError: CHECK constraint failed: start > 0]`,
    );
  });

  it('should refuse to resume from any number < 0', async ({
    expect,
    store,
    runWith2Logs: runId,
  }) => {
    await expect(
      store.resumeRun(runId, { from: -5 }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[SqliteError: CHECK constraint failed: start > 0]`,
    );
  });

  it('should refuse to resume if it would leave missing logs just before the resume number', async ({
    expect,
    store,
    runWith2Logs: runId,
  }) => {
    await expect(
      store.resumeRun(runId, { from: 4 }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[StoreError: Cannot resume run 1 from log number 4 because the minimum is 3.]`,
    );
  });

  it('should refuse to resume if it would leave missing logs in the middle', async ({
    expect,
    store,
    runWith2Logs: runId,
  }) => {
    await store.addLogs(runId, [
      { type: 'log', number: 6, values: { x: 2 } },
      { type: 'log', number: 7, values: { x: 2 } },
    ]);
    await expect(
      store.resumeRun(runId, { from: 8 }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[StoreError: Cannot resume run 1 from log number 8 because the minimum is 3.]`,
    );
  });

  it('should resume a run even if it would overwrite existing logs', async ({
    expect,
    store,
    runWith2Logs: runId,
  }) => {
    await store.addLogs(runId, [
      { type: 'log', number: 3, values: { x: 2 } },
      { type: 'log', number: 4, values: { x: 2 } },
      { type: 'log', number: 6, values: { x: 2 } },
    ]);
    await expect(store.resumeRun(runId, { from: 2 })).resolves.toBeUndefined();
  });
});

describe('SQLiteStore#addLogs', () => {
  it('should add non empty logs without error', async ({
    expect,
    runningRuns: _r,
    e1run1,
    e1run2,
    store,
  }) => {
    await expect(
      store.addLogs(e1run1, [
        { type: 'log', number: 1, values: { message: 'hello', bar: null } },
        {
          type: 'log',
          number: 2,
          values: { message: 'bonjour', recipient: 'Jo' },
        },
      ]),
    ).resolves.toBeUndefined();
    await expect(
      store.addLogs(e1run2, [
        { number: 3, type: 'other-log', values: { x: 12, foo: false } },
        { number: 4, type: 'log', values: { message: 'hola' } },
      ]),
    ).resolves.toBeUndefined();
  });

  it('should add empty logs without error', async ({
    expect,
    runningRuns,
    store,
  }) => {
    const [_exp1run1, exp1run2, exp2run1] = runningRuns;
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
    store,
    e1run1,
  }) => {
    await store.addLogs(e1run1, [
      { type: 'log', number: 1, values: { x: 1 } },
      { type: 'log', number: 2, values: { x: 2 } },
      { type: 'log', number: 3, values: { x: 2 } },
    ]);
    await expect(
      store.addLogs(e1run1, [{ type: 'log', number: 2, values: { x: 3 } }]),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[StoreError: Cannot add log: duplicated log number in the sequence.]`,
    );
    await expect(
      store.addLogs(e1run1, [
        { type: 'log', number: 3, values: { x: 3 } },
        { type: 'log', number: 4, values: { x: 3 } },
      ]),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[StoreError: Cannot add log: duplicated log number in the sequence.]`,
    );
  });

  it('should refuse to add two logs with the same number for the same run when added in the same requests', async ({
    expect,
    runningRuns: [e1run1],
    store,
  }) => {
    await expect(
      store.addLogs(e1run1, [
        { type: 'log2', number: 1, values: { x: 3 } },
        { type: 'log1', number: 3, values: { x: 1 } },
        { type: 'log2', number: 4, values: { x: 3 } },
        { type: 'log2', number: 3, values: { x: 3 } },
      ]),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[StoreError: Cannot add log: duplicated log number in the sequence.]`,
    );
    await expect(
      store.addLogs(e1run1, [
        { type: 'log1', number: 2, values: { x: 1 } },
        { type: 'log2', number: 2, values: { x: 3 } },
      ]),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[StoreError: Cannot add log: duplicated log number in the sequence.]`,
    );
  });

  it('should add logs with the same number as long as they are in different runs', async ({
    expect,
    runningRuns: [exp1run1, exp1run2, exp2run1],
    store,
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

  it('should store non consecutive logs without error', async ({
    expect,
    store,
    e1run1,
  }) => {
    await expect(
      store.addLogs(e1run1, [
        { type: 'log', number: 1, values: { x: 0 } },
        { type: 'log', number: 3, values: { x: 1 } },
      ]),
    ).resolves.toBeUndefined();
    await expect(
      store.addLogs(e1run1, [
        { type: 'log', number: 5, values: { x: 2 } },
        { type: 'log', number: 6, values: { x: 3 } },
      ]),
    ).resolves.toBeUndefined();
  });

  it('should fill in missing logs without error', async ({
    expect,
    store,
    e1run1,
  }) => {
    await expect(
      store.addLogs(e1run1, [
        { type: 'log1', number: 2, values: { x: 0 } },
        { type: 'log1', number: 5, values: { x: 1 } },
        { type: 'log1', number: 9, values: { x: 2 } },
      ]),
    ).resolves.toBeUndefined();
    await expect(
      store.addLogs(e1run1, [
        { type: 'log4', number: 7, values: { x: 3 } },
        { type: 'log5', number: 3, values: { x: 4 } },
      ]),
    ).resolves.toBeUndefined();
    await expect(
      store.addLogs(e1run1, [
        { type: 'log4', number: 1, values: { x: 3 } },
        { type: 'log4', number: 8, values: { x: 3 } },
      ]),
    ).resolves.toBeUndefined();
    await expect(
      store.addLogs(e1run1, [
        { type: 'log4', number: 10, values: { x: 3 } },
        { type: 'log4', number: 6, values: { x: 3 } },
      ]),
    ).resolves.toBeUndefined();
  });

  it('should refuse to add logs with number < 1', async ({
    expect,
    store,
    e1run1,
  }) => {
    await expect(
      store.addLogs(e1run1, [{ type: 'log4', number: 0, values: { x: 3 } }]),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[SqliteError: Cannot insert log with log_number smaller than its sequence start]`,
    );
    await expect(
      store.addLogs(e1run1, [{ type: 'log4', number: -1, values: { x: 3 } }]),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[SqliteError: Cannot insert log with log_number smaller than its sequence start]`,
    );
    await expect(
      store.addLogs(e1run1, [
        { type: 'log4', number: -1, values: { x: 3 } },
        { type: 'log4', number: 1, values: { x: 3 } },
      ]),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[SqliteError: Cannot insert log with log_number smaller than its sequence start]`,
    );
  });

  it('should add logs to a resumed run', async ({ expect, store, e1run1 }) => {
    await store.addLogs(e1run1, [
      { type: 'log4', number: 1, values: { x: 1 } },
      { type: 'log4', number: 2, values: { x: 2 } },
      { type: 'log4', number: 3, values: { x: 3 } },
    ]);
    await store.resumeRun(e1run1, { from: 4 });
    await expect(
      store.addLogs(e1run1, [
        { type: 'log4', number: 4, values: { x: 3 } },
        { type: 'log4', number: 5, values: { x: 3 } },
        { type: 'log4', number: 6, values: { x: 3 } },
      ]),
    ).resolves.toBeUndefined();
  });

  it('should add logs even if they have the same number as other logs added before resuming', async ({
    expect,
    store,
    e1run1: exp1run1,
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
    store,
    e1run1: exp1run1,
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
    store,
    e1run1: exp1run1,
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
  let exp1run1: RunId;
  let exp1run2: RunId;
  let exp2run1: RunId;
  let unknownRun: RunId;

  beforeEach<Fixture>(async ({ store, experiment1, experiment2 }) => {
    ({ runId: exp1run1 } = await store.addRun({
      runName: 'run1',
      experimentId: experiment1,
      runStatus: 'running',
    }));
    ({ runId: exp1run2 } = await store.addRun({
      runName: 'run2',
      experimentId: experiment1,
      runStatus: 'running',
    }));
    ({ runId: exp2run1 } = await store.addRun({
      runName: 'run1',
      experimentId: experiment2,
      runStatus: 'running',
    }));
    unknownRun = [1, 2, 3, 4]
      .map((x) => x.toString())
      .filter(
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

  it('should be able to return a summary for a particular run', async ({
    expect,
    store,
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

  it('should be able to filter logs by type', async ({ expect, store }) => {
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
    store,
  }) => {
    await expect(store.getLogSummary(unknownRun)).resolves.toEqual([]);
    await expect(
      store.getLogSummary(exp1run1, { type: 'do not exist' }),
    ).resolves.toEqual([]);
  });
});

describe('SQLiteStore#getLogValueNames', () => {
  beforeEach<Fixture>(
    async ({ store, runningRuns: [e1run1, e1run2, e2run1] }) => {
      await store.addLogs(e1run1, [
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
      await store.addLogs(e1run2, [
        { type: 'log2', values: { x: 12, foo: false }, number: 3 },
        { type: 'log1', values: { message: 'hola', bar: null }, number: 4 },
      ]);
      await store.addLogs(e2run1, [
        { type: 'log2', values: { x: 25, y: 0, foo: true }, number: 5 },
      ]);
    },
  );

  it('should return the names of all log values in alphabetical order', async ({
    expect,
    store,
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
    store,
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
    store,
    experiment1,
    experiment2,
  }) => {
    await expect(
      store.getLogValueNames({ experimentId: experiment1 }),
    ).resolves.toEqual(['bar', 'foo', 'message', 'recipient', 'x']);
    await expect(
      store.getLogValueNames({ experimentId: experiment2 }),
    ).resolves.toEqual(['foo', 'x', 'y']);
  });

  it('should be able to filter logs from a particular run', async ({
    expect,
    store,
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
    store,
    experiment1,
  }) => {
    await expect(
      store.getLogValueNames({ experimentId: experiment1, type: 'log2' }),
    ).resolves.toEqual(['foo', 'x']);
    await expect(
      store.getLogValueNames({
        experimentId: experiment1,
        type: 'log1',
        runName: 'run1',
      }),
    ).resolves.toEqual(['message', 'recipient']);
  });

  it('should resolve with an empty array if no log matches the filter', async ({
    expect,
    store,
    experiment2,
  }) => {
    await expect(
      store.getLogValueNames({ experimentId: experiment2, type: 'log1' }),
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
    beforeEach<Fixture>(
      async ({ store, runningRuns: [e1run1, e1run2, e2run1] }) => {
        await store.addLogs(e1run1, [
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
        await store.addLogs(e1run2, [
          { type: 'log1', number: 1, values: { message: 'hola', bar: null } },
          { type: 'log2', number: 2, values: { x: 12, foo: false } },
        ]);
        await store.addLogs(e2run1, [
          { type: 'log2', number: 1, values: { x: 25, y: 0, foo: true } },
        ]);
        await store.addLogs(e1run1, [
          { type: 'log3', number: 3, values: { x: 25, y: 0, foo: true } },
        ]);
      },
    );

    it('should return the logs in order of experimentName, runName, and ascending number', async ({
      expect,
      store,
    }) => {
      await expect(fromAsync(store.getLogs())).resolves.toMatchSnapshot();
    });

    it('should return the logs in order of experimentName, runName, and ascending number', async ({
      expect,
      store,
    }) => {
      await expect(fromAsync(store.getLogs())).resolves.toMatchSnapshot();
    });

    it('should ignore missing logs', async ({ expect, store, e2run1 }) => {
      await store.addLogs(e2run1, [
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
      await store.addLogs(e2run1, [
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
      await expect(fromAsync(store.getLogs())).resolves.toMatchSnapshot();
    });

    it('should be able to filter logs of a particular type', async ({
      expect,
      store,
    }) => {
      await expect(
        fromAsync(store.getLogs({ type: 'log1' })),
      ).resolves.toMatchSnapshot();
      await expect(
        fromAsync(store.getLogs({ type: 'log2' })),
      ).resolves.toMatchSnapshot();
    });

    it('should be able to filter logs from a particular experiment', async ({
      expect,
      store,
      experiment1,
      experiment2,
    }) => {
      await expect(
        fromAsync(store.getLogs({ experimentId: experiment1 })),
      ).resolves.toMatchSnapshot();
      await expect(
        fromAsync(store.getLogs({ experimentId: experiment2 })),
      ).resolves.toMatchSnapshot();
    });

    it('should be able to filter logs from a particular run', async ({
      expect,
      store,
    }) => {
      await expect(
        fromAsync(store.getLogs({ runName: 'run1' })),
      ).resolves.toMatchSnapshot();
      await expect(
        fromAsync(store.getLogs({ runName: 'run2' })),
      ).resolves.toMatchSnapshot();
    });

    it('should be able to filter logs by run, experiment, and type all at once', async ({
      expect,
      store,
      experiment1,
      e1run2,
    }) => {
      await expect(
        fromAsync(store.getLogs({ experimentId: experiment1, type: 'log2' })),
      ).resolves.toEqual([
        {
          experimentId: experiment1,
          experimentName: 'experiment-1',
          number: 2,
          runId: e1run2,
          runName: 'run2',
          runStatus: 'running',
          type: 'log2',
          values: { foo: false, x: 12 },
        },
      ]);
      await expect(
        fromAsync(
          store.getLogs({
            experimentId: experiment1,
            type: 'log1',
            runName: 'run1',
          }),
        ),
      ).resolves.toMatchSnapshot();
    });

    it('should resolve with an empty array if no log matches the filter', async ({
      expect,
      store,
      experiment2,
    }) => {
      await expect(
        fromAsync(store.getLogs({ experimentId: experiment2, type: 'log1' })),
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

    it('should resolve with an empty array if the filter includes an empty array', async ({
      expect,
      store,
      experiment1,
    }) => {
      await expect(
        fromAsync(store.getLogs({ experimentName: [] })),
      ).resolves.toEqual([]);
      await expect(fromAsync(store.getLogs({ type: [] }))).resolves.toEqual([]);
      await expect(fromAsync(store.getLogs({ runName: [] }))).resolves.toEqual(
        [],
      );
      await expect(
        fromAsync(
          store.getLogs({ experimentName: [], runName: 'run1', type: 'log1' }),
        ),
      ).resolves.toEqual([]);
      await expect(
        fromAsync(
          store.getLogs({
            experimentId: experiment1,
            runName: [],
            type: 'log1',
          }),
        ),
      ).resolves.toEqual([]);

      await expect(
        fromAsync(
          store.getLogs({
            experimentId: experiment1,
            runName: 'runName',
            type: [],
          }),
        ),
      ).resolves.toEqual([]);
    });

    it('should return logs added after resuming', async ({
      expect,
      store,
      e2run1,
      experiment2,
    }) => {
      await store.resumeRun(e2run1, { from: 2 });
      await store.addLogs(e2run1, [
        { type: 'log3', number: 2, values: { x: 25, y: 0, foo: true } },
      ]);
      await expect(
        fromAsync(
          store.getLogs({ experimentId: experiment2, runName: 'run1' }),
        ),
      ).resolves.toMatchSnapshot();
    });

    it('should not return logs canceled from resuming', async ({
      expect,
      store,
      e1run2,
      experiment1,
    }) => {
      await store.resumeRun(e1run2, { from: 2 });
      await expect(
        fromAsync(store.getLogs({ runId: e1run2 })),
      ).resolves.toEqual([
        {
          experimentId: experiment1,
          experimentName: 'experiment-1',
          number: 1,
          runId: e1run2,
          runName: 'run2',
          runStatus: 'running',
          type: 'log1',
          values: { bar: null, message: 'hola' },
        },
      ]);
      await store.resumeRun(e1run2, { from: 1 });
      await expect(
        fromAsync(store.getLogs({ runId: e1run2 })),
      ).resolves.toEqual([]);
    });

    it('should return logs overwriting other logs after resuming', async ({
      expect,
      store,
      e1run2,
      experiment1,
    }) => {
      await store.addLogs(e1run2, [
        { type: 'log1', number: 3, values: { x: 5 } },
        { type: 'log1', number: 4, values: { x: 6 } },
      ]);
      await expect(
        fromAsync(store.getLogs({ runId: e1run2 })),
      ).resolves.toHaveLength(4);
      await store.resumeRun(e1run2, { from: 2 });
      await expect(
        fromAsync(store.getLogs({ runId: e1run2 })),
      ).resolves.toHaveLength(1);
      await store.addLogs(e1run2, [
        { type: 'overwriting', number: 2, values: { x: 1 } },
        { type: 'overwriting', number: 3, values: { x: 2 } },
      ]);
      await expect(
        fromAsync(
          store.getLogs({ experimentId: experiment1, runName: 'run2' }),
        ),
      ).resolves.toMatchSnapshot();
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
