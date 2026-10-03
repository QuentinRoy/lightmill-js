/* eslint-disable no-empty-pattern -- Empty objects are required with vitest's fixtures */

import { times } from 'remeda';
import {
  beforeEach,
  describe,
  expect,
  type ExpectStatic,
  type TestAPI,
  vi,
  it as vitestIt,
} from 'vitest';
import { DataStoreError } from '../../src/data-store-errors.ts';
import type {
  DataStore,
  DataStoreTransaction,
  ExperimentId,
  LogId,
  RunId,
} from '../../src/data-store.ts';
import { firstStrict, fromAsync } from '../../src/utils.ts';

interface Fixture {
  store: DataStore;
  experiment1: ExperimentId;
  experiment2: ExperimentId;
  experiment3: ExperimentId;
  experiments: [ExperimentId, ExperimentId, ExperimentId];
  e1run1: RunId;
  e1run2: RunId;
  e2run1: RunId;
  runs: [RunId, RunId, RunId];
  runningRuns: [RunId, RunId, RunId];
  runWithTwoLogs: { run: RunId; logs: [LogId, LogId] };
  unknownRun: RunId;
  unknownExperiment: ExperimentId;
  mockTime: Date;
}

// Ids are numeric strings in every store we have, so the one after the
// highest is free.
function unusedId(ids: string[]) {
  return String(Math.max(0, ...ids.map(Number)) + 1);
}

export function createContractIt(createStore: () => Promise<DataStore>) {
  return vitestIt.extend<Fixture>({
    store: async ({}, use) => {
      let store = await createStore();
      await use(store);
      await store.close();
    },
    experiment1: async ({ store }, use) => {
      const now = new Date('2022-11-01T00:00:00Z');
      vi.useFakeTimers({ now, toFake: ['Date'] });
      let { experimentId } = await store.withTransaction((tx) =>
        tx.addExperiment({ experimentName: 'experiment-1' }),
      );
      vi.useRealTimers();
      await use(experimentId);
    },
    experiment2: async ({ store }, use) => {
      const now = new Date('2022-11-02T00:00:00Z');
      vi.useFakeTimers({ now, toFake: ['Date'] });
      let { experimentId } = await store.withTransaction((tx) =>
        tx.addExperiment({ experimentName: 'experiment-2' }),
      );
      vi.useRealTimers();
      await use(experimentId);
    },
    experiment3: async ({ store }, use) => {
      const now = new Date('2022-11-03T00:00:00Z');
      vi.useFakeTimers({ now, toFake: ['Date'] });
      let { experimentId } = await store.withTransaction((tx) =>
        tx.addExperiment({ experimentName: 'experiment-3' }),
      );
      vi.useRealTimers();
      await use(experimentId);
    },
    experiments: async ({ experiment1, experiment2, experiment3 }, use) => {
      use([experiment1, experiment2, experiment3]);
    },
    e1run1: async ({ store, experiment1 }, use) => {
      vi.useFakeTimers();
      vi.setSystemTime('2023-01-01T00:00:00.000Z');
      let { runId } = await store.withTransaction((tx) =>
        tx.addRun({
          runName: 'run1',
          experimentId: experiment1,
          runStatus: 'running',
        }),
      );
      vi.useRealTimers();
      await use(runId);
    },
    e1run2: async ({ store, experiment1 }, use) => {
      vi.useFakeTimers();
      vi.setSystemTime('2023-01-01T00:00:00.000Z');
      let { runId } = await store.withTransaction((tx) =>
        tx.addRun({
          runName: 'run2',
          experimentId: experiment1,
          runStatus: 'idle',
        }),
      );
      vi.useRealTimers();
      await use(runId);
    },
    e2run1: async ({ store, experiment2 }, use) => {
      vi.useFakeTimers();
      vi.setSystemTime('2023-01-01T00:00:00.000Z');
      let { runId } = await store.withTransaction((tx) =>
        tx.addRun({
          runName: 'run1',
          experimentId: experiment2,
          runStatus: 'idle',
        }),
      );
      vi.useRealTimers();
      await use(runId);
    },
    runs: async ({ e1run1: run1, e1run2: run2, e2run1: run3 }, use) => {
      await use([run1, run2, run3]);
    },
    unknownRun: async ({ store }, use) => {
      await use(unusedId((await store.getRuns()).map((run) => run.runId)));
    },
    unknownExperiment: async ({ store }, use) => {
      const experiments = await store.getExperiments();
      await use(unusedId(experiments.map((e) => e.experimentId)));
    },
    mockTime: async ({}, use) => {
      const now = new Date('2024-01-01T00:00:00Z');
      vi.useFakeTimers({ now, toFake: ['Date'] });
      await use(now);
      vi.useRealTimers();
    },
    runWithTwoLogs: async ({ store, experiment3 }, use) => {
      const { runId } = await store.withTransaction((tx) =>
        tx.addRun({ experimentId: experiment3, runStatus: 'running' }),
      );
      const logs = await store.withTransaction((tx) =>
        tx.addLogs(runId, [
          { type: 'log', number: 1, values: { x: 1 } },
          { type: 'log', number: 2, values: { x: 2 } },
        ]),
      );
      await use({
        run: runId,
        // The fixture adds exactly two logs.
        logs: logs.map((l) => l.logId) as [LogId, LogId],
      });
    },
    runningRuns: async ({ store, runs }, use) => {
      for (const runId of runs) {
        await store.withTransaction((tx) => tx.setRunStatus(runId, 'running'));
      }
      await use(runs);
    },
  });
}

/**
 * Tests every DataStore implementation must pass. They only rely on the
 * contract: the run lifecycle rules are not the store's.
 */
export function describeDataStoreContract(
  createStore: () => Promise<DataStore>,
) {
  const baseIt = createContractIt(createStore);
  const it = baseIt;

  describe('DataStore#addExperiment', () => {
    it('creates experiments with different names  ', async ({
      expect,
      store,
      mockTime,
    }) => {
      let result = await store.withTransaction((tx) =>
        tx.addExperiment({ experimentName: 'experiment-1' }),
      );
      expect(result).toMatchObject({
        experimentName: 'experiment-1',
        experimentCreatedAt: mockTime,
      });
      expect(result.experimentId).toBeDefined();
      result = await store.withTransaction((tx) =>
        tx.addExperiment({ experimentName: 'experiment-2' }),
      );
      expect(result).toMatchObject({
        experimentName: 'experiment-2',
        experimentCreatedAt: mockTime,
      });
      expect(result.experimentId).toBeDefined();
      await expect(() =>
        store.withTransaction((tx) =>
          tx.addExperiment({ experimentName: 'experiment-1' }),
        ),
      ).rejects.toMatchObject({ code: DataStoreError.EXPERIMENT_EXISTS });
    });
  });

  describe('DataStore#getExperiments', () => {
    it('gets experiments without filter', async ({
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

    it('gets experiments with filter on name', async ({
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

    it('gets experiments with filter on id', async ({
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

    it('gets experiments with filter on id and name', async ({
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

  describe('DataStore#addRun', () => {
    function isAddRunResult(result: unknown): result is { runId: RunId } {
      return (
        typeof result === 'object' &&
        result !== null &&
        'runId' in result &&
        result.runId != null
      );
    }

    it('creates runs with different ids', async ({
      expect,
      store,
      experiment1,
      experiment2,
    }) => {
      const runs = [
        await store.withTransaction((tx) =>
          tx.addRun({ runName: 'run1', experimentId: experiment1 }),
        ),
        await store.withTransaction((tx) =>
          tx.addRun({ runName: 'run2', experimentId: experiment1 }),
        ),
        await store.withTransaction((tx) =>
          tx.addRun({ runName: 'run3', experimentId: experiment2 }),
        ),
      ];
      expect(areAllUnique(runs.map((run) => run.runId))).toBe(true);
    });

    it('refuses to add a run if a run with the same id already exists for the experiment', async ({
      expect,
      store: store,
      experiment1: experimentId,
    }) => {
      await store.withTransaction((tx) =>
        tx.addRun({ runName: 'run-name', experimentId }),
      );
      await expect(
        store.withTransaction((tx) =>
          tx.addRun({ runName: 'run-name', experimentId }),
        ),
      ).rejects.toMatchObject({ code: DataStoreError.RUN_EXISTS });
    });

    it('adds a run if a run with the same id already exists but for a different experiment', async ({
      expect,
      store: store,
      experiment1,
      experiment2,
    }) => {
      await expect(
        store.withTransaction((tx) =>
          tx.addRun({ runName: 'run-id', experimentId: experiment1 }),
        ),
      ).resolves.toSatisfy(isAddRunResult);
      await expect(
        store.withTransaction((tx) =>
          tx.addRun({ runName: 'run-id', experimentId: experiment2 }),
        ),
      ).resolves.toSatisfy(isAddRunResult);
    });

    it('adds runs without specifying a name', async ({
      expect,
      store: store,
      experiment1,
    }) => {
      await expect(
        store.withTransaction((tx) => tx.addRun({ experimentId: experiment1 })),
      ).resolves.toSatisfy(isAddRunResult);
      await expect(
        store.withTransaction((tx) => tx.addRun({ experimentId: experiment1 })),
      ).resolves.toSatisfy(isAddRunResult);
      await expect(
        store.withTransaction((tx) => tx.addRun({ experimentId: experiment1 })),
      ).resolves.toSatisfy(isAddRunResult);
    });

    it('throws with a meaningful error if the experiment does not exist', async ({
      expect,
      store: store,
      unknownExperiment,
    }) => {
      await expect(
        store.withTransaction((tx) =>
          tx.addRun({ experimentId: unknownExperiment }),
        ),
      ).rejects.toMatchObject({ code: DataStoreError.EXPERIMENT_NOT_FOUND });
    });
  });

  describe('DataStore#getRuns', () => {
    it('returns the run corresponding to a runId', async ({
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
          firstMissingLogNumber: null,
          lastLogNumber: 0,
          runCreatedAt: new Date('2023-01-01T00:00:00.000Z'),
          runId: runs[0],
        },
      ]);
      await expect(store.getRuns({ runId: runs[1] })).resolves.toEqual([
        {
          runName: 'run2',
          experimentId: experiment1,
          runStatus: 'idle',
          firstMissingLogNumber: null,
          lastLogNumber: 0,
          runCreatedAt: new Date('2023-01-01T00:00:00.000Z'),
          runId: runs[1],
        },
      ]);
      await expect(store.getRuns({ runId: runs[2] })).resolves.toEqual([
        {
          runName: 'run1',
          experimentId: experiment2,
          runStatus: 'idle',
          firstMissingLogNumber: null,
          lastLogNumber: 0,
          runCreatedAt: new Date('2023-01-01T00:00:00.000Z'),
          runId: runs[2],
        },
      ]);
    });

    it('returns an empty array if no corresponding runs are found', async ({
      expect,
      store,
      unknownRun,
    }) => {
      await expect(store.getRuns({ runId: unknownRun })).resolves.toEqual([]);
    });

    it('returns all runs if no filter is provided', async ({
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
          firstMissingLogNumber: null,
          lastLogNumber: 0,
        },
        {
          experimentId: experiment1,
          runCreatedAt: new Date('2023-01-01T00:00:00.000Z'),
          runId: runs[1],
          runName: 'run2',
          runStatus: 'idle',
          firstMissingLogNumber: null,
          lastLogNumber: 0,
        },
        {
          experimentId: experiment2,
          runCreatedAt: new Date('2023-01-01T00:00:00.000Z'),
          runId: runs[2],
          runName: 'run1',
          runStatus: 'idle',
          firstMissingLogNumber: null,
          lastLogNumber: 0,
        },
      ]);
    });

    it('returns all runs corresponding to an experiment name', async ({
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
          firstMissingLogNumber: null,
          lastLogNumber: 0,
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
          firstMissingLogNumber: null,
          lastLogNumber: 0,
        },
        {
          experimentId: experiment1,
          runCreatedAt: new Date('2023-01-01T00:00:00.000Z'),
          runId: runs[1],
          runName: 'run2',
          runStatus: 'idle',
          firstMissingLogNumber: null,
          lastLogNumber: 0,
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
          firstMissingLogNumber: null,
          lastLogNumber: 0,
        },
        {
          experimentId: experiment1,
          runCreatedAt: new Date('2023-01-01T00:00:00.000Z'),
          runId: runs[1],
          runName: 'run2',
          runStatus: 'idle',
          firstMissingLogNumber: null,
          lastLogNumber: 0,
        },
        {
          experimentId: experiment2,
          runCreatedAt: new Date('2023-01-01T00:00:00.000Z'),
          runId: runs[2],
          runName: 'run1',
          runStatus: 'idle',
          firstMissingLogNumber: null,
          lastLogNumber: 0,
        },
      ]);
    });

    it('returns all runs corresponding to a run name', async ({
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
          firstMissingLogNumber: null,
          lastLogNumber: 0,
        },
      ]);
      await expect(store.getRuns({ runName: 'run1' })).resolves.toEqual([
        {
          experimentId: experiment1,
          runCreatedAt: new Date('2023-01-01T00:00:00.000Z'),
          runId: runs[0],
          runName: 'run1',
          runStatus: 'running',
          firstMissingLogNumber: null,
          lastLogNumber: 0,
        },
        {
          experimentId: experiment2,
          runCreatedAt: new Date('2023-01-01T00:00:00.000Z'),
          runId: runs[2],
          runName: 'run1',
          runStatus: 'idle',
          firstMissingLogNumber: null,
          lastLogNumber: 0,
        },
      ]);
      await expect(
        store.getRuns({ runName: ['run1', 'run2'] }),
      ).resolves.toEqual([
        {
          experimentId: experiment1,
          runCreatedAt: new Date('2023-01-01T00:00:00.000Z'),
          runId: runs[0],
          runName: 'run1',
          runStatus: 'running',
          firstMissingLogNumber: null,
          lastLogNumber: 0,
        },
        {
          experimentId: experiment1,
          runCreatedAt: new Date('2023-01-01T00:00:00.000Z'),
          runId: runs[1],
          runName: 'run2',
          runStatus: 'idle',
          firstMissingLogNumber: null,
          lastLogNumber: 0,
        },
        {
          experimentId: experiment2,
          runCreatedAt: new Date('2023-01-01T00:00:00.000Z'),
          runId: runs[2],
          runName: 'run1',
          runStatus: 'idle',
          firstMissingLogNumber: null,
          lastLogNumber: 0,
        },
      ]);
    });

    it('returns all runs with a specific status', async ({
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
          firstMissingLogNumber: null,
          lastLogNumber: 0,
        },
      ]);
      await expect(store.getRuns({ runStatus: '-idle' })).resolves.toEqual([
        {
          experimentId: experiment1,
          runCreatedAt: new Date('2023-01-01T00:00:00.000Z'),
          runId: runs[0],
          runName: 'run1',
          runStatus: 'running',
          firstMissingLogNumber: null,
          lastLogNumber: 0,
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
          firstMissingLogNumber: null,
          lastLogNumber: 0,
        },
        {
          experimentId: experiment2,
          runCreatedAt: new Date('2023-01-01T00:00:00.000Z'),
          runId: runs[2],
          runName: 'run1',
          runStatus: 'idle',
          firstMissingLogNumber: null,
          lastLogNumber: 0,
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
          firstMissingLogNumber: null,
          lastLogNumber: 0,
        },
        {
          experimentId: experiment1,
          runCreatedAt: new Date('2023-01-01T00:00:00.000Z'),
          runId: runs[1],
          runName: 'run2',
          runStatus: 'idle',
          firstMissingLogNumber: null,
          lastLogNumber: 0,
        },
        {
          experimentId: experiment2,
          runCreatedAt: new Date('2023-01-01T00:00:00.000Z'),
          runId: runs[2],
          runName: 'run1',
          runStatus: 'idle',
          firstMissingLogNumber: null,
          lastLogNumber: 0,
        },
      ]);
    });

    it('returns an empty array if part of the filter is an empty array', async ({
      expect,
      store,
      experiment1,
      runs: _r,
    }) => {
      // Add a run without a name to ensure runName is null does not match.
      await store.withTransaction((tx) =>
        tx.addRun({ experimentId: experiment1 }),
      );
      // Check that the runs are actually created first (vitest fixtures can be a bit tricky, e.g.
      // if comments are added in the test arguments, I've had issues).
      await expect(store.getRuns()).resolves.toHaveLength(4);
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

  describe('DataStore#getRuns log numbers', () => {
    async function getLogNumbers(store: DataStore, runId: RunId) {
      const [run] = await store.getRuns({ runId });
      if (run == null) throw new Error(`Run ${runId} not found`);
      return {
        firstMissingLogNumber: run.firstMissingLogNumber,
        lastLogNumber: run.lastLogNumber,
      };
    }
    function logs(...numbers: number[]) {
      return numbers.map((number) => ({ type: 'log', number, values: {} }));
    }

    it('reports the last log number of a run without missing logs', async ({
      expect,
      store,
      e1run1: run,
    }) => {
      await store.withTransaction((tx) => tx.addLogs(run, logs(1, 2, 3)));
      await expect(getLogNumbers(store, run)).resolves.toEqual({
        firstMissingLogNumber: null,
        lastLogNumber: 3,
      });
    });

    it('reports a missing log number behind a skipped one', async ({
      expect,
      store,
      e1run1: run,
    }) => {
      await store.withTransaction((tx) => tx.addLogs(run, logs(1, 5)));
      await expect(getLogNumbers(store, run)).resolves.toEqual({
        firstMissingLogNumber: 2,
        lastLogNumber: 1,
      });
    });

    it('accepts a log number far ahead of the others', async ({
      expect,
      store,
      e1run1: run,
    }) => {
      await store.withTransaction((tx) => tx.addLogs(run, logs(1, 1e12)));
      await expect(getLogNumbers(store, run)).resolves.toEqual({
        firstMissingLogNumber: 2,
        lastLogNumber: 1,
      });
      await store.withTransaction((tx) =>
        tx.addLogs(run, logs(Number.MAX_SAFE_INTEGER)),
      );
      await store.withTransaction((tx) => tx.addLogs(run, logs(2)));
      await expect(getLogNumbers(store, run)).resolves.toEqual({
        firstMissingLogNumber: 3,
        lastLogNumber: 2,
      });
    });

    it('drops missing log numbers canceled by cancelLogsAfter', async ({
      expect,
      store,
      e1run1: run,
    }) => {
      await store.withTransaction((tx) => tx.addLogs(run, logs(1, 2, 5, 9)));
      await store.withTransaction((tx) =>
        tx.cancelLogsAfter(run, { after: 2 }),
      );
      await expect(getLogNumbers(store, run)).resolves.toEqual({
        firstMissingLogNumber: null,
        lastLogNumber: 2,
      });
      await store.withTransaction((tx) => tx.addLogs(run, logs(3, 4)));
      await expect(getLogNumbers(store, run)).resolves.toEqual({
        firstMissingLogNumber: null,
        lastLogNumber: 4,
      });
    });

    it('tracks missing log numbers through a split, a cancellation, and a fill', async ({
      expect,
      store,
      e1run1: run,
    }) => {
      await store.withTransaction((tx) => tx.addLogs(run, logs(1, 10, 5)));
      await store.withTransaction((tx) =>
        tx.cancelLogsAfter(run, { after: 1 }),
      );
      await store.withTransaction((tx) => tx.addLogs(run, logs(3)));
      await expect(getLogNumbers(store, run)).resolves.toEqual({
        firstMissingLogNumber: 2,
        lastLogNumber: 1,
      });
      await store.withTransaction((tx) => tx.addLogs(run, logs(2)));
      await expect(getLogNumbers(store, run)).resolves.toEqual({
        firstMissingLogNumber: null,
        lastLogNumber: 3,
      });
    });

    it('tracks missing log numbers through a fill, a cancellation, and a far-ahead log', async ({
      expect,
      store,
      e1run1: run,
    }) => {
      await store.withTransaction((tx) => tx.addLogs(run, logs(1, 3)));
      await store.withTransaction((tx) => tx.addLogs(run, logs(2)));
      await store.withTransaction((tx) =>
        tx.cancelLogsAfter(run, { after: 3 }),
      );
      await expect(getLogNumbers(store, run)).resolves.toEqual({
        firstMissingLogNumber: null,
        lastLogNumber: 3,
      });
      await store.withTransaction((tx) => tx.addLogs(run, logs(1e12)));
      await expect(getLogNumbers(store, run)).resolves.toEqual({
        firstMissingLogNumber: 4,
        lastLogNumber: 3,
      });
    });

    it('reports the last log number after canceling many logs', async ({
      expect,
      store,
      e1run1: run,
    }) => {
      await store.withTransaction((tx) =>
        tx.addLogs(run, logs(1, 2, 3, 4, 5, 6)),
      );
      await store.withTransaction((tx) =>
        tx.cancelLogsAfter(run, { after: 1 }),
      );
      await expect(getLogNumbers(store, run)).resolves.toEqual({
        firstMissingLogNumber: null,
        lastLogNumber: 1,
      });
      await store.withTransaction((tx) =>
        tx.cancelLogsAfter(run, { after: 0 }),
      );
      await expect(getLogNumbers(store, run)).resolves.toEqual({
        firstMissingLogNumber: null,
        lastLogNumber: 0,
      });
    });

    it('ignores missing log numbers canceled by cancelLogsAfter', async ({
      expect,
      store,
      e1run1: run,
    }) => {
      await store.withTransaction((tx) => tx.addLogs(run, logs(2, 3, 1, 8)));
      await store.withTransaction((tx) => tx.addLogs(run, logs(5)));
      await store.withTransaction((tx) =>
        tx.cancelLogsAfter(run, { after: 3 }),
      );
      await store.withTransaction((tx) => tx.addLogs(run, logs(6)));
      await expect(getLogNumbers(store, run)).resolves.toEqual({
        firstMissingLogNumber: 4,
        lastLogNumber: 3,
      });
      await store.withTransaction((tx) => tx.addLogs(run, logs(4)));
      await expect(getLogNumbers(store, run)).resolves.toEqual({
        firstMissingLogNumber: 5,
        lastLogNumber: 4,
      });
    });

    it('fills a missing log number from the bottom of a gap', async ({
      expect,
      store,
      e1run1: run,
    }) => {
      await store.withTransaction((tx) => tx.addLogs(run, logs(1, 5)));
      await store.withTransaction((tx) => tx.addLogs(run, logs(2)));
      await expect(getLogNumbers(store, run)).resolves.toEqual({
        firstMissingLogNumber: 3,
        lastLogNumber: 2,
      });
    });

    it('fills a missing log number from the top of a gap', async ({
      expect,
      store,
      e1run1: run,
    }) => {
      await store.withTransaction((tx) => tx.addLogs(run, logs(1, 5)));
      await store.withTransaction((tx) => tx.addLogs(run, logs(4)));
      await expect(getLogNumbers(store, run)).resolves.toEqual({
        firstMissingLogNumber: 2,
        lastLogNumber: 1,
      });
      await store.withTransaction((tx) => tx.addLogs(run, logs(2, 3)));
      await expect(getLogNumbers(store, run)).resolves.toEqual({
        firstMissingLogNumber: null,
        lastLogNumber: 5,
      });
    });

    it('splits a gap when a log fills a number in its middle', async ({
      expect,
      store,
      e1run1: run,
    }) => {
      await store.withTransaction((tx) => tx.addLogs(run, logs(1, 10)));
      await store.withTransaction((tx) => tx.addLogs(run, logs(5)));
      await expect(getLogNumbers(store, run)).resolves.toEqual({
        firstMissingLogNumber: 2,
        lastLogNumber: 1,
      });
      await store.withTransaction((tx) => tx.addLogs(run, logs(2, 3, 4)));
      await expect(getLogNumbers(store, run)).resolves.toEqual({
        firstMissingLogNumber: 6,
        lastLogNumber: 5,
      });
    });

    it('closes a gap once all its log numbers are filled', async ({
      expect,
      store,
      e1run1: run,
    }) => {
      await store.withTransaction((tx) => tx.addLogs(run, logs(1, 3, 6)));
      await store.withTransaction((tx) => tx.addLogs(run, logs(2)));
      await expect(getLogNumbers(store, run)).resolves.toEqual({
        firstMissingLogNumber: 4,
        lastLogNumber: 3,
      });
      await store.withTransaction((tx) => tx.addLogs(run, logs(5, 4)));
      await expect(getLogNumbers(store, run)).resolves.toEqual({
        firstMissingLogNumber: null,
        lastLogNumber: 6,
      });
    });
  });

  describe('DataStore#setRunStatus', () => {
    it('sets the status of the run if it exists', async ({
      expect,
      store,
      runs,
    }) => {
      await expect(
        store.withTransaction((tx) => tx.setRunStatus(runs[0], 'completed')),
      ).resolves.toBeUndefined();
      await expect(
        store.withTransaction((tx) => tx.setRunStatus(runs[1], 'canceled')),
      ).resolves.toBeUndefined();
    });

    it('throws if the run does not exist', async ({
      expect,
      store,
      unknownRun,
    }) => {
      await expect(
        store.withTransaction((tx) => tx.setRunStatus(unknownRun, 'completed')),
      ).rejects.toMatchObject({ code: DataStoreError.RUN_NOT_FOUND });
    });
  });

  describe('DataStore#cancelLogsAfter', () => {
    const cancelAfter = (store: DataStore, run: RunId, after: number) =>
      store.withTransaction((tx) => tx.cancelLogsAfter(run, { after }));
    async function getLastLogNumber(store: DataStore, runId: RunId) {
      const [run] = await store.getRuns({ runId });
      if (run == null) throw new Error(`Run ${runId} not found`);
      return run.lastLogNumber;
    }

    it('cancels the logs after the given number', async ({
      expect,
      store,
      runWithTwoLogs: { run },
    }) => {
      await cancelAfter(store, run, 1);
      await expect(getLastLogNumber(store, run)).resolves.toBe(1);
      await expect(store.getLastLogs({ runId: run })).resolves.toMatchObject([
        { number: 1 },
      ]);
    });

    it('cancels every log with after 0', async ({
      expect,
      store,
      runWithTwoLogs: { run },
    }) => {
      await cancelAfter(store, run, 0);
      await expect(getLastLogNumber(store, run)).resolves.toBe(0);
      await expect(store.getLastLogs({ runId: run })).resolves.toEqual([]);
    });

    it('keeps every log with after at the last log number', async ({
      expect,
      store,
      runWithTwoLogs: { run },
    }) => {
      await cancelAfter(store, run, 2);
      await expect(getLastLogNumber(store, run)).resolves.toBe(2);
    });

    it('stops counting the canceled logs', async ({
      expect,
      store,
      runWithTwoLogs: { run },
    }) => {
      await cancelAfter(store, run, 1);
      const kept = await fromAsync(store.getLogs({ runId: run }));
      expect(kept.map((log) => log.number)).toEqual([1]);
      // The canceled number can be written again, with other content.
      await expect(
        store.withTransaction((tx) =>
          tx.addLogs(run, [
            { type: 'log', number: 2, values: { other: true } },
          ]),
        ),
      ).resolves.toEqual([{ logId: expect.any(String), created: true }]);
    });

    it('does not change the run status', async ({
      expect,
      store,
      runWithTwoLogs: { run },
    }) => {
      await store.withTransaction((tx) => tx.setRunStatus(run, 'interrupted'));
      await cancelAfter(store, run, 1);
      await expect(store.getRuns({ runId: run })).resolves.toMatchObject([
        { runStatus: 'interrupted' },
      ]);
    });

    it('works on a run without logs', async ({
      expect,
      store,
      e1run1: run,
    }) => {
      await expect(cancelAfter(store, run, 0)).resolves.toBeUndefined();
    });

    it('throws if the run does not exist', async ({
      expect,
      store,
      unknownRun,
    }) => {
      await expect(cancelAfter(store, unknownRun, 0)).rejects.toMatchObject({
        code: DataStoreError.RUN_NOT_FOUND,
      });
    });
  });

  describe('DataStore#addLogs', () => {
    function anyLogResult(n: number, e: ExpectStatic = expect) {
      let o = { logId: e.any(String), created: true };
      return times(n, () => o);
    }

    it('adds non empty logs', async ({
      expect,
      runningRuns: _r,
      e1run1,
      e1run2,
      store,
    }) => {
      await expect(
        store.withTransaction((tx) =>
          tx.addLogs(e1run1, [
            { type: 'log', number: 1, values: { foo: 'hello', bar: null } },
            { type: 'log', number: 2, values: { x: [1, 2], y: null } },
          ]),
        ),
      ).resolves.toEqual(anyLogResult(2, expect));
      await expect(
        store.withTransaction((tx) =>
          tx.addLogs(e1run2, [
            { number: 3, type: 'other-log', values: { x: 12, foo: false } },
            { number: 4, type: 'log', values: { message: 'hola' } },
          ]),
        ),
      ).resolves.toEqual(anyLogResult(2, expect));
    });

    it('adds empty logs', async ({
      expect,
      runningRuns: [_exp1run1, exp1run2, exp2run1],
      store,
    }) => {
      await expect(
        store.withTransaction((tx) =>
          tx.addLogs(exp1run2, [
            { type: 'log', number: 1, values: {} },
            { type: 'log', number: 2, values: {} },
          ]),
        ),
      ).resolves.toEqual(anyLogResult(2, expect));
      await expect(
        store.withTransaction((tx) =>
          tx.addLogs(exp2run1, [
            { number: 3, type: 'other-log', values: {} },
            { number: 4, type: 'log', values: {} },
          ]),
        ),
      ).resolves.toEqual(anyLogResult(2, expect));
    });

    it('refuses to add two logs with the same number for the same run when added in two different requests', async ({
      expect,
      store,
      e1run1,
    }) => {
      await store.withTransaction((tx) =>
        tx.addLogs(e1run1, [
          { type: 'log', number: 1, values: { x: 1 } },
          { type: 'log', number: 2, values: { x: 2 } },
          { type: 'log', number: 3, values: { x: 2 } },
        ]),
      );
      await expect(
        store.withTransaction((tx) =>
          tx.addLogs(e1run1, [{ type: 'log', number: 2, values: { x: 3 } }]),
        ),
      ).rejects.toMatchObject({
        code: DataStoreError.LOG_NUMBER_EXISTS_IN_SEQUENCE,
      });
      await expect(
        store.withTransaction((tx) =>
          tx.addLogs(e1run1, [
            { type: 'log', number: 3, values: { x: 3 } },
            { type: 'log', number: 4, values: { x: 3 } },
          ]),
        ),
      ).rejects.toMatchObject({
        code: DataStoreError.LOG_NUMBER_EXISTS_IN_SEQUENCE,
      });
    });

    it('accepts a resent log and returns the stored id', async ({
      expect,
      store,
      e1run1,
    }) => {
      const first = firstStrict(
        await store.withTransaction((tx) =>
          tx.addLogs(e1run1, [
            { type: 'log', number: 1, values: { x: 1, y: { a: 1, b: [2] } } },
          ]),
        ),
      );
      await expect(
        store.withTransaction((tx) =>
          tx.addLogs(e1run1, [
            // Key order does not matter.
            { type: 'log', number: 1, values: { y: { b: [2], a: 1 }, x: 1 } },
          ]),
        ),
      ).resolves.toEqual([{ logId: first.logId, created: false }]);
      await expect(store.getLogValueNames({ runId: e1run1 })).resolves.toEqual([
        'x',
        'y',
      ]);
    });

    it('adds only the new logs of a batch that partly duplicates stored ones', async ({
      expect,
      store,
      e1run1,
    }) => {
      const first = firstStrict(
        await store.withTransaction((tx) =>
          tx.addLogs(e1run1, [{ type: 'log', number: 1, values: { x: 1 } }]),
        ),
      );
      const result = await store.withTransaction((tx) =>
        tx.addLogs(e1run1, [
          { type: 'log', number: 2, values: { z: 1 } },
          { type: 'log', number: 1, values: { x: 1 } },
        ]),
      );
      expect(result[1]).toEqual({ logId: first.logId, created: false });
      expect(result[0]).toMatchObject({ created: true });
      expect(firstStrict(result).logId).not.toEqual(first.logId);
      await expect(store.getLogValueNames({ runId: e1run1 })).resolves.toEqual([
        'x',
        'z',
      ]);
    });

    it('refuses a conflicting log (same number, different type) and stores nothing of its batch', async ({
      expect,
      store,
      e1run1,
    }) => {
      await store.withTransaction((tx) =>
        tx.addLogs(e1run1, [{ type: 'log', number: 1, values: {} }]),
      );
      await expect(
        store.withTransaction((tx) =>
          tx.addLogs(e1run1, [
            { type: 'log', number: 2, values: {} },
            { type: 'other', number: 1, values: {} },
          ]),
        ),
      ).rejects.toMatchObject({
        code: DataStoreError.LOG_NUMBER_EXISTS_IN_SEQUENCE,
      });
      await expect(
        store.withTransaction((tx) =>
          tx.addLogs(e1run1, [{ type: 'log', number: 2, values: {} }]),
        ),
      ).resolves.toEqual(anyLogResult(1, expect));
    });

    it('compares a resent log with the run current sequence only', async ({
      expect,
      store,
      e1run1,
    }) => {
      await store.withTransaction((tx) =>
        tx.addLogs(e1run1, [
          { type: 'log', number: 1, values: {} },
          { type: 'log', number: 2, values: { x: 'canceled' } },
        ]),
      );
      await store.withTransaction((tx) =>
        tx.cancelLogsAfter(e1run1, { after: 1 }),
      );
      const added = firstStrict(
        await store.withTransaction((tx) =>
          tx.addLogs(e1run1, [
            { type: 'log', number: 2, values: { x: 'kept' } },
          ]),
        ),
      );
      await expect(
        store.withTransaction((tx) =>
          tx.addLogs(e1run1, [
            { type: 'log', number: 2, values: { x: 'kept' } },
          ]),
        ),
      ).resolves.toEqual([{ logId: added.logId, created: false }]);
      await expect(
        store.withTransaction((tx) =>
          tx.addLogs(e1run1, [
            { type: 'log', number: 2, values: { x: 'canceled' } },
          ]),
        ),
      ).rejects.toMatchObject({
        code: DataStoreError.LOG_NUMBER_EXISTS_IN_SEQUENCE,
      });
    });

    it('refuses to add two logs with the same number for the same run when added in the same requests', async ({
      expect,
      runningRuns: [e1run1],
      store,
    }) => {
      await expect(
        store.withTransaction((tx) =>
          tx.addLogs(e1run1, [
            { type: 'log2', number: 1, values: { x: 3 } },
            { type: 'log1', number: 3, values: { x: 1 } },
            { type: 'log2', number: 4, values: { x: 3 } },
            { type: 'log2', number: 3, values: { x: 3 } },
          ]),
        ),
      ).rejects.toMatchObject({
        code: DataStoreError.LOG_NUMBER_EXISTS_IN_SEQUENCE,
      });
      await expect(
        store.withTransaction((tx) =>
          tx.addLogs(e1run1, [
            { type: 'log1', number: 2, values: { x: 1 } },
            { type: 'log2', number: 2, values: { x: 3 } },
          ]),
        ),
      ).rejects.toMatchObject({
        code: DataStoreError.LOG_NUMBER_EXISTS_IN_SEQUENCE,
      });
    });

    it('adds logs with the same number as long as they are in different runs', async ({
      expect,
      runningRuns: [exp1run1, exp1run2, exp2run1],
      store,
    }) => {
      await expect(
        store.withTransaction((tx) =>
          tx.addLogs(exp1run1, [
            { type: 'log', number: 1, values: { x: 1 } },
            { type: 'log', number: 2, values: { x: 2 } },
          ]),
        ),
      ).resolves.toEqual(anyLogResult(2, expect));
      await expect(
        store.withTransaction((tx) =>
          tx.addLogs(exp2run1, [
            { type: 'log', number: 2, values: { x: 3 } },
            { type: 'log', number: 1, values: { x: 1 } },
          ]),
        ),
      ).resolves.toEqual(anyLogResult(2, expect));
      await expect(
        store.withTransaction((tx) =>
          tx.addLogs(exp1run2, [
            { type: 'log', number: 2, values: { x: 3 } },
            { type: 'log', number: 1, values: { x: 1 } },
          ]),
        ),
      ).resolves.toEqual(anyLogResult(2, expect));
    });

    it('adds non consecutive logs', async ({ expect, store, e1run1 }) => {
      await expect(
        store.withTransaction((tx) =>
          tx.addLogs(e1run1, [
            { type: 'log', number: 1, values: { x: 0 } },
            { type: 'log', number: 3, values: { x: 1 } },
          ]),
        ),
      ).resolves.toEqual(anyLogResult(2, expect));
      await expect(
        store.withTransaction((tx) =>
          tx.addLogs(e1run1, [
            { type: 'log', number: 5, values: { x: 2 } },
            { type: 'log', number: 6, values: { x: 3 } },
          ]),
        ),
      ).resolves.toEqual(anyLogResult(2, expect));
    });

    it('fills in missing logs', async ({ expect, store, e1run1 }) => {
      await expect(
        store.withTransaction((tx) =>
          tx.addLogs(e1run1, [
            { type: 'log1', number: 2, values: { x: 0 } },
            { type: 'log1', number: 5, values: { x: 1 } },
            { type: 'log1', number: 9, values: { x: 2 } },
          ]),
        ),
      ).resolves.toEqual(anyLogResult(3, expect));
      await expect(
        store.withTransaction((tx) =>
          tx.addLogs(e1run1, [
            { type: 'log4', number: 7, values: { x: 3 } },
            { type: 'log5', number: 3, values: { x: 4 } },
          ]),
        ),
      ).resolves.toEqual(anyLogResult(2, expect));
      await expect(
        store.withTransaction((tx) =>
          tx.addLogs(e1run1, [
            { type: 'log4', number: 1, values: { x: 3 } },
            { type: 'log4', number: 8, values: { x: 3 } },
          ]),
        ),
      ).resolves.toEqual(anyLogResult(2, expect));
      await expect(
        store.withTransaction((tx) =>
          tx.addLogs(e1run1, [
            { type: 'log4', number: 10, values: { x: 3 } },
            { type: 'log4', number: 6, values: { x: 3 } },
          ]),
        ),
      ).resolves.toEqual(anyLogResult(2, expect));
    });

    it('adds logs after canceling logs', async ({ expect, store, e1run1 }) => {
      await store.withTransaction((tx) =>
        tx.addLogs(e1run1, [
          { type: 'log4', number: 1, values: { x: 1 } },
          { type: 'log4', number: 2, values: { x: 2 } },
          { type: 'log4', number: 3, values: { x: 3 } },
        ]),
      );
      await store.withTransaction((tx) =>
        tx.cancelLogsAfter(e1run1, { after: 3 }),
      );
      await expect(
        store.withTransaction((tx) =>
          tx.addLogs(e1run1, [
            { type: 'log4', number: 4, values: { x: 3 } },
            { type: 'log4', number: 5, values: { x: 3 } },
            { type: 'log4', number: 6, values: { x: 3 } },
          ]),
        ),
      ).resolves.toEqual(anyLogResult(3, expect));
    });

    it('adds logs even if they have the same number as logs that were canceled', async ({
      expect,
      store,
      e1run1: exp1run1,
    }) => {
      await store.withTransaction((tx) =>
        tx.addLogs(exp1run1, [
          { type: 'log4', number: 1, values: { x: 1 } },
          { type: 'log4', number: 2, values: { x: 2 } },
          { type: 'log4', number: 3, values: { x: 3 } },
        ]),
      );
      await store.withTransaction((tx) =>
        tx.cancelLogsAfter(exp1run1, { after: 1 }),
      );
      await expect(
        store.withTransaction((tx) =>
          tx.addLogs(exp1run1, [
            { type: 'log4', number: 2, values: { x: 3 } },
            { type: 'log4', number: 3, values: { x: 3 } },
          ]),
        ),
      ).resolves.toEqual(anyLogResult(2, expect));
    });

    it('adds logs after canceling logs, even if it creates a gap in log numbers', async ({
      expect,
      store,
      e1run1: exp1run1,
    }) => {
      await store.withTransaction((tx) =>
        tx.addLogs(exp1run1, [
          { type: 'log4', number: 1, values: { x: 1 } },
          { type: 'log4', number: 2, values: { x: 2 } },
          { type: 'log4', number: 3, values: { x: 3 } },
        ]),
      );
      await store.withTransaction((tx) =>
        tx.cancelLogsAfter(exp1run1, { after: 3 }),
      );
      await expect(
        store.withTransaction((tx) =>
          tx.addLogs(exp1run1, [
            { type: 'log4', number: 7, values: { x: 3 } },
            { type: 'log4', number: 8, values: { x: 3 } },
          ]),
        ),
      ).resolves.toEqual(anyLogResult(2, expect));
    });
  });

  describe('DataStore#getLastLogs', () => {
    type Fixture = {
      context: {
        store: DataStore;
        exp1run1: RunId;
        exp1run2: RunId;
        exp2run1: RunId;
        unknownRun: RunId;
        exp1: ExperimentId;
        exp2: ExperimentId;
        logBases: { any: object; e1r1: object; e1r2: object; e2r1: object };
      };
    };
    // I am intentionally hiding from the fixture every props from
    // baseIt's fixture.
    const it: TestAPI<Fixture> = baseIt.extend<Fixture>({
      context: async ({ store, experiment1, experiment2 }, use) => {
        let { runId: exp1run1 } = await store.withTransaction((tx) =>
          tx.addRun({
            runName: 'run1',
            experimentId: experiment1,
            runStatus: 'running',
          }),
        );
        let { runId: exp1run2 } = await store.withTransaction((tx) =>
          tx.addRun({
            runName: 'run2',
            experimentId: experiment1,
            runStatus: 'running',
          }),
        );
        let { runId: exp2run1 } = await store.withTransaction((tx) =>
          tx.addRun({
            runName: 'run1',
            experimentId: experiment2,
            runStatus: 'running',
          }),
        );
        let knownRunIds = new Set((await store.getRuns()).map((r) => r.runId));
        let unknownRun = 'x';
        while (knownRunIds.has(unknownRun)) {
          unknownRun = unknownRun + 'x';
        }
        await store.withTransaction((tx) =>
          tx.addLogs(exp1run1, [
            { number: 2, type: 'log1', values: { x: 10 } },
            { number: 3, type: 'log1', values: { x: 11 } },
          ]),
        );
        await store.withTransaction((tx) =>
          tx.addLogs(exp1run1, [
            { number: 8, type: 'log1', values: { x: 20 } },
            { number: 5, type: 'log1', values: { x: 21 } },
          ]),
        );
        await store.withTransaction((tx) =>
          tx.addLogs(exp1run1, [
            { number: 1, type: 'log2', values: { x: 30 } },
          ]),
        );
        await store.withTransaction((tx) =>
          tx.addLogs(exp1run2, [
            { number: 1, type: 'log2', values: { x: 40 } },
            { number: 2, type: 'log1', values: { x: 41 } },
            { number: 3, type: 'log1', values: { x: 42 } },
          ]),
        );
        let anyLogBase = {
          logId: expect.any(String),
          runId: expect.any(String),
        };
        await use({
          exp1run1,
          exp1run2,
          exp2run1,
          unknownRun,
          store,
          exp1: experiment1,
          exp2: experiment2,
          logBases: {
            any: anyLogBase,
            e1r1: { ...anyLogBase, runId: exp1run1 },
            e1r2: { ...anyLogBase, runId: exp1run2 },
            e2r1: { ...anyLogBase, runId: exp2run1 },
          },
        });
      },
    });

    it('returns all last logs', async ({
      expect,
      context: { store, logBases },
    }) => {
      await expect(store.getLastLogs()).resolves.toEqual([
        { ...logBases.e1r1, type: 'log1', number: 3, values: { x: 11 } },
        { ...logBases.e1r1, type: 'log2', number: 1, values: { x: 30 } },
        { ...logBases.e1r2, type: 'log1', number: 3, values: { x: 42 } },
        { ...logBases.e1r2, type: 'log2', number: 1, values: { x: 40 } },
      ]);
    });

    it('ignores any log following a missing log', async ({
      expect,
      context: { store, logBases, exp2run1, exp1run2 },
    }) => {
      // No logs from this run are actually confirmed since
      // log number 1 and 2 are missing.
      await store.withTransaction((tx) =>
        tx.addLogs(exp2run1, [
          { number: 3, type: 'log3', values: { x: 51 } },
          { number: 4, type: 'log2', values: { x: 50 } },
          { number: 6, type: 'log3', values: { x: 52 } },
        ]),
      );

      await store.withTransaction((tx) =>
        tx.addLogs(exp1run2, [
          { number: 4, type: 'log2', values: { x: 54 } },
          { number: 6, type: 'log2', values: { x: 56 } },
          { number: 7, type: 'log3', values: { x: 57 } },
          { number: 8, type: 'log1', values: { x: 58 } },
        ]),
      );

      await expect(store.getLastLogs()).resolves.toEqual([
        { ...logBases.e1r1, type: 'log1', number: 3, values: { x: 11 } },
        { ...logBases.e1r1, type: 'log2', number: 1, values: { x: 30 } },
        { ...logBases.e1r2, type: 'log1', number: 3, values: { x: 42 } },
        { ...logBases.e1r2, type: 'log2', number: 4, values: { x: 54 } },
      ]);
    });

    it('ignores missing logs canceled by cancelLogsAfter', async ({
      expect,
      context: { store, logBases, exp1run1 },
    }) => {
      await store.withTransaction((tx) =>
        tx.cancelLogsAfter(exp1run1, { after: 3 }),
      );
      await store.withTransaction((tx) =>
        tx.addLogs(exp1run1, [{ number: 4, type: 'log1', values: { x: 60 } }]),
      );
      await expect(store.getLastLogs({ runId: exp1run1 })).resolves.toEqual([
        { ...logBases.e1r1, type: 'log1', number: 4, values: { x: 60 } },
        { ...logBases.e1r1, type: 'log2', number: 1, values: { x: 30 } },
      ]);
    });

    it('ignores overwritten logs', async ({
      expect,
      context: { store, logBases, exp2run1, exp1run2 },
    }) => {
      // No logs from this run are actually confirmed since
      // log number 1 and 2 are missing.
      await store.withTransaction((tx) =>
        tx.addLogs(exp2run1, [
          { number: 3, type: 'log3', values: { x: 51 } },
          { number: 4, type: 'log2', values: { x: 50 } },
          { number: 6, type: 'log3', values: { x: 52 } },
        ]),
      );

      await store.withTransaction((tx) =>
        tx.addLogs(exp1run2, [
          { number: 4, type: 'log2', values: { x: 54 } },
          { number: 5, type: 'log2', values: { x: 55 } },
          { number: 7, type: 'log3', values: { x: 57 } },
          { number: 8, type: 'log1', values: { x: 58 } },
        ]),
      );

      await store.withTransaction((tx) =>
        tx.cancelLogsAfter(exp1run2, { after: 3 }),
      );

      await expect(store.getLastLogs()).resolves.toEqual([
        { ...logBases.e1r1, type: 'log1', number: 3, values: { x: 11 } },
        { ...logBases.e1r1, type: 'log2', number: 1, values: { x: 30 } },
        { ...logBases.e1r2, type: 'log1', number: 3, values: { x: 42 } },
        { ...logBases.e1r2, type: 'log2', number: 1, values: { x: 40 } },
      ]);
    });

    it('returns an empty array if there are no matching logs', async ({
      expect,
      context: { store },
    }) => {
      await expect(store.getLastLogs({ logType: 'unknown' })).resolves.toEqual(
        [],
      );
      const { experimentId } = await store.withTransaction((tx) =>
        tx.addExperiment({ experimentName: 'any' }),
      );
      const { runId } = await store.withTransaction((tx) =>
        tx.addRun({ experimentId }),
      );
      await expect(store.getLastLogs({ runId })).resolves.toEqual([]);
    });

    it('filters logs by run ids', async ({
      expect,
      context: { store, exp1run1, exp1run2, exp2run1, logBases },
    }) => {
      await expect(store.getLastLogs({ runId: exp1run1 })).resolves.toEqual([
        { ...logBases.e1r1, type: 'log1', number: 3, values: { x: 11 } },
        { ...logBases.e1r1, type: 'log2', number: 1, values: { x: 30 } },
      ]);
      await expect(store.getLastLogs({ runId: exp1run2 })).resolves.toEqual([
        { ...logBases.e1r2, type: 'log1', number: 3, values: { x: 42 } },
        { ...logBases.e1r2, type: 'log2', number: 1, values: { x: 40 } },
      ]);
      await expect(store.getLastLogs({ runId: exp2run1 })).resolves.toEqual([]);
      await expect(
        store.getLastLogs({ runId: [exp1run1, exp1run2] }),
      ).resolves.toEqual([
        { ...logBases.e1r1, type: 'log1', number: 3, values: { x: 11 } },
        { ...logBases.e1r1, type: 'log2', number: 1, values: { x: 30 } },
        { ...logBases.e1r2, type: 'log1', number: 3, values: { x: 42 } },
        { ...logBases.e1r2, type: 'log2', number: 1, values: { x: 40 } },
      ]);
    });

    it('filters logs by run names', async ({
      expect,
      context: { store, exp2, exp2run1, logBases },
    }) => {
      // I want a confirmed log in exp2run1.
      await store.withTransaction((tx) =>
        tx.addLogs(exp2run1, [{ number: 1, type: 'log5', values: { x: 60 } }]),
      );
      // I also want a run with a name that's not run1 or run2
      let { runId: runx } = await store.withTransaction((tx) =>
        tx.addRun({
          runName: 'runx',
          runStatus: 'running',
          experimentId: exp2,
        }),
      );
      await store.withTransaction((tx) =>
        tx.addLogs(runx, [
          { number: 1, type: 'log5', values: { x: 70 } },
          { number: 2, type: 'log5', values: { x: 71 } },
        ]),
      );
      await expect(store.getLastLogs({ runName: 'run1' })).resolves.toEqual([
        { ...logBases.e1r1, type: 'log1', number: 3, values: { x: 11 } },
        { ...logBases.e1r1, type: 'log2', number: 1, values: { x: 30 } },
        { ...logBases.e2r1, number: 1, type: 'log5', values: { x: 60 } },
      ]);
      await expect(store.getLastLogs({ runName: 'run2' })).resolves.toEqual([
        { ...logBases.e1r2, type: 'log1', number: 3, values: { x: 42 } },
        { ...logBases.e1r2, type: 'log2', number: 1, values: { x: 40 } },
      ]);
      await expect(
        store.getLastLogs({ runName: ['run1', 'run2'] }),
      ).resolves.toEqual([
        { ...logBases.e1r1, type: 'log1', number: 3, values: { x: 11 } },
        { ...logBases.e1r1, type: 'log2', number: 1, values: { x: 30 } },
        { ...logBases.e1r2, type: 'log1', number: 3, values: { x: 42 } },
        { ...logBases.e1r2, type: 'log2', number: 1, values: { x: 40 } },
        { ...logBases.e2r1, number: 1, type: 'log5', values: { x: 60 } },
      ]);
    });

    it('filters logs by experiment name', async ({
      expect,
      context: { store, logBases, exp2run1 },
    }) => {
      // I want a confirmed log in experiment-2.
      await store.withTransaction((tx) =>
        tx.addLogs(exp2run1, [{ number: 1, type: 'log5', values: { x: 60 } }]),
      );
      await expect(
        store.getLastLogs({ experimentName: 'experiment-1' }),
      ).resolves.toEqual([
        { ...logBases.e1r1, type: 'log1', number: 3, values: { x: 11 } },
        { ...logBases.e1r1, type: 'log2', number: 1, values: { x: 30 } },
        { ...logBases.e1r2, type: 'log1', number: 3, values: { x: 42 } },
        { ...logBases.e1r2, type: 'log2', number: 1, values: { x: 40 } },
      ]);
      await expect(
        store.getLastLogs({ experimentName: 'experiment-2' }),
      ).resolves.toEqual([
        { ...logBases.e2r1, type: 'log5', number: 1, values: { x: 60 } },
      ]);
      await expect(
        store.getLastLogs({ experimentName: ['experiment-1', 'experiment-2'] }),
      ).resolves.toEqual([
        { ...logBases.e1r1, type: 'log1', number: 3, values: { x: 11 } },
        { ...logBases.e1r1, type: 'log2', number: 1, values: { x: 30 } },
        { ...logBases.e1r2, type: 'log1', number: 3, values: { x: 42 } },
        { ...logBases.e1r2, type: 'log2', number: 1, values: { x: 40 } },
        { ...logBases.e2r1, type: 'log5', number: 1, values: { x: 60 } },
      ]);
    });

    it('filters logs by experiment id', async ({
      expect,
      context: { store, logBases, exp2run1, exp1, exp2 },
    }) => {
      // I want a log in experiment-2.
      await store.withTransaction((tx) =>
        tx.addLogs(exp2run1, [{ number: 1, type: 'log5', values: { x: 60 } }]),
      );
      await expect(store.getLastLogs({ experimentId: exp1 })).resolves.toEqual([
        { ...logBases.e1r1, type: 'log1', number: 3, values: { x: 11 } },
        { ...logBases.e1r1, type: 'log2', number: 1, values: { x: 30 } },
        { ...logBases.e1r2, type: 'log1', number: 3, values: { x: 42 } },
        { ...logBases.e1r2, type: 'log2', number: 1, values: { x: 40 } },
      ]);
      await expect(store.getLastLogs({ experimentId: exp2 })).resolves.toEqual([
        { ...logBases.e2r1, type: 'log5', number: 1, values: { x: 60 } },
      ]);
      await expect(
        store.getLastLogs({ experimentId: [exp2, exp1] }),
      ).resolves.toEqual([
        { ...logBases.e1r1, type: 'log1', number: 3, values: { x: 11 } },
        { ...logBases.e1r1, type: 'log2', number: 1, values: { x: 30 } },
        { ...logBases.e1r2, type: 'log1', number: 3, values: { x: 42 } },
        { ...logBases.e1r2, type: 'log2', number: 1, values: { x: 40 } },
        { ...logBases.e2r1, type: 'log5', number: 1, values: { x: 60 } },
      ]);
    });

    it('filters logs by type', async ({
      expect,
      context: { store, logBases },
    }) => {
      await expect(store.getLastLogs({ logType: 'log2' })).resolves.toEqual([
        { ...logBases.e1r1, number: 1, type: 'log2', values: { x: 30 } },
        { ...logBases.e1r2, number: 1, type: 'log2', values: { x: 40 } },
      ]);
      await expect(
        store.getLastLogs({ logType: ['log1', 'log2'] }),
      ).resolves.toEqual([
        { ...logBases.e1r1, type: 'log1', number: 3, values: { x: 11 } },
        { ...logBases.e1r1, type: 'log2', number: 1, values: { x: 30 } },
        { ...logBases.e1r2, type: 'log1', number: 3, values: { x: 42 } },
        { ...logBases.e1r2, type: 'log2', number: 1, values: { x: 40 } },
      ]);
    });

    it('should resolve with an empty array if no log matches the filter', async ({
      expect,
      context: { store, unknownRun },
    }) => {
      await expect(store.getLastLogs({ runId: unknownRun })).resolves.toEqual(
        [],
      );
      await expect(
        store.getLastLogs({ logType: ['do not exist', 'do no existe either'] }),
      ).resolves.toEqual([]);
      await expect(
        store.getLastLogs({ experimentName: 'unknown' }),
      ).resolves.toEqual([]);
    });
  });

  describe('DataStore#getLogValueNames', () => {
    beforeEach<Fixture>(
      async ({ store, runningRuns: [e1run1, e1run2, e2run1] }) => {
        await store.withTransaction((tx) =>
          tx.addLogs(e1run1, [
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
          ]),
        );
        await store.withTransaction((tx) =>
          tx.addLogs(e1run2, [
            { type: 'log2', values: { x: 12, foo: false }, number: 3 },
            { type: 'log1', values: { message: 'hola', bar: null }, number: 4 },
          ]),
        );
        await store.withTransaction((tx) =>
          tx.addLogs(e2run1, [
            { type: 'log2', values: { x: 25, y: 0, foo: true }, number: 5 },
          ]),
        );
      },
    );

    it('returns the names of all log values in alphabetical order', async ({
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

    it('filters logs of a particular type', async ({ expect, store }) => {
      await expect(
        store.getLogValueNames({ logType: 'log1' }),
      ).resolves.toEqual(['bar', 'message', 'recipient']);
      await expect(
        store.getLogValueNames({ logType: 'log2' }),
      ).resolves.toEqual(['foo', 'x', 'y']);
    });

    it('filters logs from a particular experiment', async ({
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

    it('filters logs from a particular run', async ({ expect, store }) => {
      await expect(
        store.getLogValueNames({ runName: 'run1' }),
      ).resolves.toEqual(['foo', 'message', 'recipient', 'x', 'y']);
      await expect(
        store.getLogValueNames({ runName: 'run2' }),
      ).resolves.toEqual(['bar', 'foo', 'message', 'x']);
    });

    it('filters logs by run, experiment, and type all at once', async ({
      expect,
      store,
      experiment1,
    }) => {
      await expect(
        store.getLogValueNames({ experimentId: experiment1, logType: 'log2' }),
      ).resolves.toEqual(['foo', 'x']);
      await expect(
        store.getLogValueNames({
          experimentId: experiment1,
          logType: 'log1',
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
        store.getLogValueNames({ experimentId: experiment2, logType: 'log1' }),
      ).resolves.toEqual([]);
      await expect(
        store.getLogValueNames({ experimentName: 'do not exist' }),
      ).resolves.toEqual([]);
      await expect(
        store.getLogValueNames({ runName: 'do not exist' }),
      ).resolves.toEqual([]);
      await expect(
        store.getLogValueNames({ logType: 'do not exist' }),
      ).resolves.toEqual([]);
    });

    it('ignores values from canceled logs', async ({ store }) => {
      let { experimentId } = await store.withTransaction((tx) =>
        tx.addExperiment({ experimentName: 'exp' }),
      );
      let { runId } = await store.withTransaction((tx) =>
        tx.addRun({ experimentId, runStatus: 'running' }),
      );
      await store.withTransaction((tx) =>
        tx.addLogs(runId, [
          { type: 'log', number: 1, values: { x: 'x' } },
          { type: 'log', number: 2, values: { x: 'x' } },
          { type: 'log', number: 3, values: { nope: 'nope' } },
        ]),
      );
      await store.withTransaction((tx) =>
        tx.setRunStatus(runId, 'interrupted'),
      );
      await store.withTransaction((tx) =>
        tx.cancelLogsAfter(runId, { after: 2 }),
      );
      await expect(store.getLogValueNames({ runId })).resolves.toEqual(['x']);
    });
  });

  describe('DataStore#withTransaction', () => {
    const log = (number: number) => ({
      type: 'log',
      number,
      values: { number },
    });
    const boom = new Error('boom');

    // One of each write kind, on rows that exist before the transaction.
    async function writeEverything(
      tx: DataStoreTransaction,
      { run, otherRun }: { run: RunId; otherRun: RunId },
    ) {
      const { experimentId } = await tx.addExperiment({
        experimentName: 'tx-experiment',
      });
      await tx.addRun({ experimentId, runName: 'tx-run' });
      await tx.setRunStatus(otherRun, 'canceled');
      await tx.addLogs(run, [log(1), log(2), log(3)]);
      await tx.cancelLogsAfter(run, { after: 1 });
    }
    async function snapshot(store: DataStore) {
      return {
        experiments: await store.getExperiments(),
        runs: await store.getRuns(),
        logs: await fromAsync(store.getLogs()),
      };
    }

    it('resolves with what the callback returns', async ({ expect, store }) => {
      await expect(store.withTransaction(async () => 42)).resolves.toBe(42);
    });

    it('commits every kind of write', async ({
      expect,
      store,
      e1run1: run,
      e1run2: otherRun,
    }) => {
      await store.withTransaction((tx) =>
        writeEverything(tx, { run, otherRun }),
      );
      await expect(
        store.getExperiments({ experimentName: 'tx-experiment' }),
      ).resolves.toHaveLength(1);
      await expect(store.getRuns({ runName: 'tx-run' })).resolves.toHaveLength(
        1,
      );
      await expect(store.getRuns({ runId: otherRun })).resolves.toMatchObject([
        { runStatus: 'canceled' },
      ]);
      await expect(store.getRuns({ runId: run })).resolves.toMatchObject([
        { lastLogNumber: 1 },
      ]);
    });

    it('rolls back every kind of write when the callback throws', async ({
      expect,
      store,
      e1run1: run,
      e1run2: otherRun,
    }) => {
      const before = await snapshot(store);
      await expect(
        store.withTransaction(async (tx) => {
          await writeEverything(tx, { run, otherRun });
          throw boom;
        }),
      ).rejects.toBe(boom);
      await expect(snapshot(store)).resolves.toEqual(before);
    });

    it('lets a callback read its own writes', async ({ expect, store }) => {
      await store.withTransaction(async (tx) => {
        await tx.addExperiment({ experimentName: 'mine' });
        await expect(
          tx.getExperiments({ experimentName: 'mine' }),
        ).resolves.toHaveLength(1);
      });
    });

    it('streams logs inside a transaction', async ({
      expect,
      store,
      runWithTwoLogs: { run },
    }) => {
      await store.withTransaction(async (tx) => {
        await tx.addLogs(run, [log(3)]);
        const logs = await fromAsync(tx.getLogs({ runId: run }));
        expect(logs.map((l) => l.number)).toEqual([1, 2, 3]);
      });
    });

    it('keeps the transaction usable after a caught log conflict', async ({
      expect,
      store,
      e1run1: run,
    }) => {
      await store.withTransaction((tx) => tx.addLogs(run, [log(1)]));
      await store.withTransaction(async (tx) => {
        await expect(
          tx.addLogs(run, [{ type: 'other', number: 1, values: {} }]),
        ).rejects.toMatchObject({
          code: DataStoreError.LOG_NUMBER_EXISTS_IN_SEQUENCE,
          logNumber: 1,
        });
        await tx.addExperiment({ experimentName: 'after-conflict' });
      });
      await expect(
        store.getExperiments({ experimentName: 'after-conflict' }),
      ).resolves.toHaveLength(1);
    });

    it('does not let a conflicting duplicate through when the batch also adds', async ({
      expect,
      store,
      e1run1: run,
    }) => {
      await store.withTransaction((tx) => tx.addLogs(run, [log(1)]));
      await expect(
        store.withTransaction(async (tx) => {
          await tx.addLogs(run, [log(2)]);
          await tx.addLogs(run, [{ type: 'other', number: 1, values: {} }]);
        }),
      ).rejects.toMatchObject({
        code: DataStoreError.LOG_NUMBER_EXISTS_IN_SEQUENCE,
      });
      await expect(store.getRuns({ runId: run })).resolves.toMatchObject([
        { lastLogNumber: 1 },
      ]);
    });

    describe('run names', () => {
      it('frees the name of a canceled run', async ({
        expect,
        store,
        e1run1: run,
        experiment1,
      }) => {
        await store.withTransaction((tx) => tx.setRunStatus(run, 'canceled'));
        await expect(
          store.withTransaction((tx) =>
            tx.addRun({ experimentId: experiment1, runName: 'run1' }),
          ),
        ).resolves.toMatchObject({ runName: 'run1' });
      });

      it('lets only one of two concurrent transactions take a name', async ({
        expect,
        store,
        experiment1,
      }) => {
        const results = await Promise.allSettled(
          times(2, () =>
            store.withTransaction((tx) =>
              tx.addRun({ experimentId: experiment1, runName: 'same' }),
            ),
          ),
        );
        expect(results.map((r) => r.status).sort()).toEqual([
          'fulfilled',
          'rejected',
        ]);
        const failure = results.find((r) => r.status === 'rejected');
        expect(failure).toMatchObject({
          reason: { code: DataStoreError.RUN_EXISTS },
        });
        await expect(store.getRuns({ runName: 'same' })).resolves.toHaveLength(
          1,
        );
      });
    });

    it('is serializable: concurrent read-modify-write transactions never lose an update', async ({
      expect,
      store,
    }) => {
      const results = await Promise.allSettled(
        times(8, () =>
          store.withTransaction(async (tx) => {
            const count = (await tx.getExperiments()).length;
            await tx.addExperiment({ experimentName: `experiment-${count}` });
          }),
        ),
      );
      const committed = results.filter((r) => r.status === 'fulfilled').length;
      for (const result of results) {
        if (result.status === 'rejected') {
          expect(result.reason).toMatchObject({
            code: DataStoreError.TRANSACTION_CONFLICT,
          });
        }
      }
      const experiments = await store.getExperiments();
      const names = experiments.map((e) => e.experimentName);
      // Each committed transaction saw all the previous ones.
      expect(names.length).toBeGreaterThanOrEqual(committed);
      expect(new Set(names).size).toBe(names.length);
      for (let i = 0; i < names.length; i++) {
        expect(names).toContain(`experiment-${i}`);
      }
    });

    describe('after the callback settled', () => {
      async function keepTransaction(store: DataStore) {
        let kept!: DataStoreTransaction;
        await store.withTransaction(async (tx) => {
          kept = tx;
        });
        return kept;
      }

      it('rejects every call on a kept transaction with TRANSACTION_ENDED', async ({
        expect,
        store,
        e1run1: run,
        experiment1,
      }) => {
        const tx = await keepTransaction(store);
        const ended = { code: DataStoreError.TRANSACTION_ENDED };
        await expect(
          tx.addExperiment({ experimentName: 'x' }),
        ).rejects.toMatchObject(ended);
        await expect(
          tx.addRun({ experimentId: experiment1 }),
        ).rejects.toMatchObject(ended);
        await expect(tx.setRunStatus(run, 'running')).rejects.toMatchObject(
          ended,
        );
        await expect(
          tx.cancelLogsAfter(run, { after: 0 }),
        ).rejects.toMatchObject(ended);
        await expect(tx.addLogs(run, [log(1)])).rejects.toMatchObject(ended);
        await expect(tx.getExperiments()).rejects.toMatchObject(ended);
        await expect(tx.getRuns()).rejects.toMatchObject(ended);
        await expect(tx.getLastLogs()).rejects.toMatchObject(ended);
        await expect(tx.getLogValueNames()).rejects.toMatchObject(ended);
        await expect(tx.getLogs().next()).rejects.toMatchObject(ended);
      });

      it('rejects the next pull of a kept generator', async ({
        expect,
        store,
        runWithTwoLogs: { run },
      }) => {
        // The default page holds every log, so only a pull after the end can
        // tell the generator guards the transaction.
        let generator!: AsyncGenerator<unknown>;
        await store.withTransaction(async (tx) => {
          generator = tx.getLogs({ runId: run });
          await generator.next();
        });
        await expect(generator.next()).rejects.toMatchObject({
          code: DataStoreError.TRANSACTION_ENDED,
        });
      });

      it('rolls back and rejects with a TypeError if a call was left pending', async ({
        expect,
        store,
      }) => {
        await expect(
          store.withTransaction(async (tx) => {
            // Not awaited.
            void tx.addExperiment({ experimentName: 'forgotten' });
          }),
        ).rejects.toThrow(TypeError);
        await expect(store.getExperiments()).resolves.toEqual([]);
      });

      it('swallows the rejection of a call left pending', async ({
        expect,
        store,
        unknownExperiment,
      }) => {
        const unhandled = vi.fn();
        process.once('unhandledRejection', unhandled);
        await expect(
          store.withTransaction(async (tx) => {
            void tx.addRun({ experimentId: unknownExperiment });
          }),
        ).rejects.toThrow(TypeError);
        await new Promise((resolve) => setTimeout(resolve, 10));
        process.off('unhandledRejection', unhandled);
        expect(unhandled).not.toHaveBeenCalled();
      });
    });

    it('refuses to nest transactions', async ({ expect, store }) => {
      await expect(
        store.withTransaction(async (tx) => {
          // @ts-expect-error The transaction has no withTransaction.
          await tx.withTransaction(async () => {});
        }),
      ).rejects.toThrow(TypeError);
    });
  });

  describe('DataStore#close', () => {
    it('rejects operations with STORE_CLOSED once closed', async ({
      expect,
      store,
    }) => {
      await store.close();
      const closed = { code: DataStoreError.STORE_CLOSED };
      await expect(store.getExperiments()).rejects.toMatchObject(closed);
      await expect(store.getRuns()).rejects.toMatchObject(closed);
      await expect(store.getLastLogs()).rejects.toMatchObject(closed);
      await expect(store.getLogValueNames()).rejects.toMatchObject(closed);
      await expect(store.getLogs().next()).rejects.toMatchObject(closed);
      await expect(store.withTransaction(async () => 1)).rejects.toMatchObject(
        closed,
      );
    });

    it('rejects the next pull of a log generator that was started before', async ({
      expect,
      store,
      runWithTwoLogs: { run },
    }) => {
      const logs = store.getLogs({ runId: run });
      await logs.next();
      await store.close();
      await expect(logs.next()).rejects.toMatchObject({
        code: DataStoreError.STORE_CLOSED,
      });
    });

    it('is idempotent', async ({ expect, store }) => {
      const first = store.close();
      await expect(store.close()).resolves.toBeUndefined();
      await expect(first).resolves.toBeUndefined();
      await expect(store.close()).resolves.toBeUndefined();
    });

    it('waits for the transaction in flight', async ({ expect, store }) => {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      let entered!: () => void;
      const inside = new Promise<void>((resolve) => (entered = resolve));
      const transaction = store.withTransaction(async (tx) => {
        await tx.addExperiment({ experimentName: 'in-flight' });
        entered();
        await gate;
      });
      await inside;
      let closed = false;
      const closing = store.close().then(() => (closed = true));
      await expect(store.getExperiments()).rejects.toMatchObject({
        code: DataStoreError.STORE_CLOSED,
      });
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(closed).toBe(false);
      release();
      await expect(transaction).resolves.toBeUndefined();
      await closing;
      expect(closed).toBe(true);
    });

    it('waits for a read admitted before it', async ({ expect, store }) => {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      let entered!: () => void;
      const inside = new Promise<void>((resolve) => (entered = resolve));
      const transaction = store.withTransaction(async (tx) => {
        await tx.addExperiment({ experimentName: 'in-flight' });
        entered();
        await gate;
      });
      await inside;
      const read = store.getExperiments();
      const closing = store.close();
      release();
      await transaction;
      await expect(read).resolves.toEqual([
        expect.objectContaining({ experimentName: 'in-flight' }),
      ]);
      await closing;
    });
  });
}

function areAllUnique<T>(values: T[]): boolean {
  return new Set(values).size === values.length;
}
