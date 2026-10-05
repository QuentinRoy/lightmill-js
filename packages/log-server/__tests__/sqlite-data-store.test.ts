/* eslint-disable no-empty-pattern -- Empty objects are required with vitest's fixtures */

import SQLiteDB from 'better-sqlite3';
import loglevel from 'loglevel';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  vi,
  it as vitestIt,
} from 'vitest';
import { DataStoreError } from '../src/data-store-errors.ts';
import type { ExperimentId, LogId, RunId } from '../src/data-store.ts';
import { mapBusyError, SQLiteDataStore } from '../src/sqlite-data-store.ts';
import { fromAsync } from '../src/utils.ts';
import {
  createContractIt,
  describeDataStoreContract,
} from './__fixtures__/data-store-contract.ts';

// Prevent kysely from logging anything.
loglevel.setDefaultLevel('silent');

afterEach(() => {
  vi.restoreAllMocks();
});

const openStore = () => SQLiteDataStore.open(':memory:');
const baseIt = createContractIt(openStore);
const it = baseIt;

describeDataStoreContract(openStore);

describe('SQLiteStore.open', () => {
  let directory: string;
  let database: string;
  beforeEach(() => {
    directory = mkdtempSync(path.join(os.tmpdir(), 'lightmill-open-'));
    database = path.join(directory, 'data.sqlite');
  });
  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('opens a migrated database', async () => {
    await SQLiteDataStore.migrateDatabase(database);
    let store = await SQLiteDataStore.open(database);
    await expect(store.getExperiments()).resolves.toEqual([]);
    await store.close();
  });

  it('rejects a database with pending migrations', async () => {
    // An empty file is a valid SQLite database with no schema.
    writeFileSync(database, '');
    await expect(SQLiteDataStore.open(database)).rejects.toMatchObject({
      code: DataStoreError.SCHEMA_OUTDATED,
    });
  });

  it('cannot be bypassed by calling the constructor', () => {
    const args = { key: Symbol(), db: {} as never, selectQueryLimit: 1 };
    // @ts-expect-error The constructor is not meant to be called.
    const construct = () => new SQLiteDataStore(args);
    expect(construct).toThrow(TypeError);
  });

  it('does not create a missing database', async () => {
    await expect(SQLiteDataStore.open(database)).rejects.toThrow();
    expect(existsSync(database)).toBe(false);
  });

  it('migrates an in-memory database', async () => {
    let store = await SQLiteDataStore.open(':memory:');
    await expect(store.getExperiments()).resolves.toEqual([]);
    await store.close();
  });
});

describe('SQLiteStore.migrateDatabase', () => {
  it('creates and migrates a new database, and can run twice', async () => {
    let directory = mkdtempSync(path.join(os.tmpdir(), 'lightmill-migrate-'));
    try {
      let database = path.join(directory, 'data.sqlite');
      await SQLiteDataStore.migrateDatabase(database);
      await SQLiteDataStore.migrateDatabase(database);
      await (await SQLiteDataStore.open(database)).close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe('SQLite constraints and triggers', () => {
  const logRows = (...numbers: number[]) =>
    numbers.map((number) => ({ type: 'log', number, values: { x: number } }));

  // The server decides which status can follow which, so the database only
  // refuses a status that does not exist.
  describe('run status', () => {
    it('refuses to set an unknown status', async ({
      expect,
      store,
      e1run1,
    }) => {
      await expect(
        // @ts-expect-error we are intentionally setting an unknown status
        store.withTransaction((tx) => tx.setRunStatus(e1run1, 'unknown')),
      ).rejects.toThrow();
    });
  });

  // The guard is private to SQLite, which relies on it for log gaps.
  describe('resume point guard', () => {
    it('refuses to cancel logs after a missing log number', async ({
      expect,
      store,
      runWithTwoLogs: { run },
    }) => {
      await store.withTransaction((tx) => tx.addLogs(run, logRows(5)));
      await expect(
        store.withTransaction((tx) => tx.cancelLogsAfter(run, { after: 4 })),
      ).rejects.toThrow();
      await expect(store.getRuns({ runId: run })).resolves.toMatchObject([
        { lastLogNumber: 2, firstMissingLogNumber: 3 },
      ]);
    });

    it('refuses to cancel logs one number after the last log number', async ({
      expect,
      store,
      runWithTwoLogs: { run },
    }) => {
      await store.withTransaction((tx) => tx.addLogs(run, logRows(5)));
      await expect(
        store.withTransaction((tx) => tx.cancelLogsAfter(run, { after: 3 })),
      ).rejects.toThrow();
    });
  });

  describe('log numbers', () => {
    it('refuses to add logs with number < 1', async ({
      expect,
      store,
      e1run1,
    }) => {
      await expect(
        store.withTransaction((tx) =>
          tx.addLogs(e1run1, [{ type: 'log4', number: 0, values: { x: 3 } }]),
        ),
      ).rejects.toThrow();
      await expect(
        store.withTransaction((tx) =>
          tx.addLogs(e1run1, [{ type: 'log4', number: -1, values: { x: 3 } }]),
        ),
      ).rejects.toThrow();
      await expect(
        store.withTransaction((tx) =>
          tx.addLogs(e1run1, [
            { type: 'log4', number: -1, values: { x: 3 } },
            { type: 'log4', number: 1, values: { x: 3 } },
          ]),
        ),
      ).rejects.toThrow();
    });

    it('refuses to add logs numbered below where the logs were canceled', async ({
      expect,
      store,
      e1run1: exp1run1,
    }) => {
      await store.withTransaction((tx) =>
        tx.addLogs(exp1run1, [
          { type: 'log4', number: 1, values: { x: 1 } },
          { type: 'log4', number: 2, values: { x: 1 } },
        ]),
      );
      await store.withTransaction((tx) =>
        tx.cancelLogsAfter(exp1run1, { after: 2 }),
      );
      await expect(
        store.withTransaction((tx) =>
          tx.addLogs(exp1run1, [
            { type: 'log4', number: 2, values: { x: 3 } },
            { type: 'log4', number: 3, values: { x: 3 } },
            { type: 'log4', number: 4, values: { x: 3 } },
          ]),
        ),
      ).rejects.toThrow();
    });
  });
});

describe('mapBusyError', () => {
  const sqliteError = (code: string) => {
    const error = new SQLiteDB.SqliteError('busy', code);
    return error;
  };

  vitestIt.each([
    'SQLITE_BUSY',
    'SQLITE_BUSY_SNAPSHOT',
    'SQLITE_BUSY_RECOVERY',
    'SQLITE_LOCKED',
    'SQLITE_LOCKED_SHAREDCACHE',
  ])('maps %s to TRANSACTION_CONFLICT', (code) => {
    const cause = sqliteError(code);
    const mapped = mapBusyError(cause);
    expect(mapped).toBeInstanceOf(DataStoreError);
    expect(mapped).toMatchObject({
      code: DataStoreError.TRANSACTION_CONFLICT,
      cause,
    });
  });

  vitestIt.each(['SQLITE_CONSTRAINT_UNIQUE', 'SQLITE_FULL', 'SQLITE_BUSYISH'])(
    'leaves %s alone',
    (code) => {
      const error = sqliteError(code);
      expect(mapBusyError(error)).toBe(error);
    },
  );

  it('leaves other errors alone', () => {
    const error = new Error('busy');
    expect(mapBusyError(error)).toBe(error);
  });
});

describe('SQLiteDataStore transactions', () => {
  it('closes when disposed of', async () => {
    const store = await openStore();
    await store[Symbol.asyncDispose]();
    await expect(store.getExperiments()).rejects.toMatchObject({
      code: DataStoreError.STORE_CLOSED,
    });
  });

  // Makes the driver fail on one statement, as a full disk or a lock held by
  // another process would.
  function failStatement(statement: string, code: string) {
    const prepare = SQLiteDB.prototype.prepare;
    vi.spyOn(SQLiteDB.prototype, 'prepare').mockImplementation(function (
      this: SQLiteDB.Database,
      source: string,
    ) {
      if (source === statement) {
        throw new SQLiteDB.SqliteError(`${statement} failed`, code);
      }
      return prepare.call(this, source);
    } as typeof SQLiteDB.prototype.prepare);
  }

  it('maps a busy BEGIN to TRANSACTION_CONFLICT and frees the connection', async () => {
    const store = await openStore();
    failStatement('BEGIN IMMEDIATE', 'SQLITE_BUSY');
    await expect(store.withTransaction(async () => 1)).rejects.toMatchObject({
      code: DataStoreError.TRANSACTION_CONFLICT,
    });
    vi.restoreAllMocks();
    await expect(store.withTransaction(async () => 1)).resolves.toBe(1);
    await store.close();
  });

  it('rolls back and maps a busy COMMIT to TRANSACTION_CONFLICT', async () => {
    const store = await openStore();
    failStatement('COMMIT', 'SQLITE_BUSY');
    await expect(
      store.withTransaction((tx) => tx.addExperiment({ experimentName: 'x' })),
    ).rejects.toMatchObject({ code: DataStoreError.TRANSACTION_CONFLICT });
    vi.restoreAllMocks();
    await expect(store.getExperiments()).resolves.toEqual([]);
    await expect(store.withTransaction(async () => 1)).resolves.toBe(1);
    await store.close();
  });

  it('rolls back and rejects with TRANSACTION_COMMIT_FAILED when COMMIT fails', async () => {
    const store = await openStore();
    failStatement('COMMIT', 'SQLITE_FULL');
    await expect(
      store.withTransaction((tx) => tx.addExperiment({ experimentName: 'x' })),
    ).rejects.toMatchObject({
      code: DataStoreError.TRANSACTION_COMMIT_FAILED,
      cause: { code: 'SQLITE_FULL' },
    });
    vi.restoreAllMocks();
    await expect(store.getExperiments()).resolves.toEqual([]);
    await store.close();
  });

  it('poisons the store when ROLLBACK fails', async () => {
    const store = await openStore();
    const boom = new Error('boom');
    failStatement('ROLLBACK', 'SQLITE_IOERR');
    const failure = await store
      .withTransaction(async (tx) => {
        await tx.addExperiment({ experimentName: 'x' });
        throw boom;
      })
      .catch((error: unknown) => error);
    expect(failure).toMatchObject({
      code: DataStoreError.TRANSACTION_ROLLBACK_FAILED,
      originalError: boom,
      cause: { code: 'SQLITE_IOERR' },
    });
    vi.restoreAllMocks();
    await expect(store.getExperiments()).rejects.toBe(failure);
    await expect(store.withTransaction(async () => 1)).rejects.toBe(failure);
    await expect(store.close()).resolves.toBeUndefined();
  });

  it('queues session writes behind an open transaction', async () => {
    const store = await openStore();
    const sessions = store.getSessionStore();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let entered!: () => void;
    const inside = new Promise<void>((resolve) => (entered = resolve));
    const transaction = store.withTransaction(async (tx) => {
      await tx.addExperiment({ experimentName: 'locked' });
      entered();
      await gate;
    });
    await inside;
    let written = false;
    const write = new Promise<void>((resolve, reject) => {
      sessions.set(
        'sid',
        // The store only reads the cookie expiry.
        { cookie: { originalMaxAge: null } } as never,
        (error) => {
          written = true;
          if (error) reject(error);
          else resolve();
        },
      );
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(written).toBe(false);
    release();
    await transaction;
    await write;
    expect(written).toBe(true);
    await store.close();
  });

  it('does not hold the connection between pulls of getLogs', async () => {
    const store = await SQLiteDataStore.open(':memory:', {
      selectQueryLimit: 2,
    });
    const { runId } = await store.withTransaction(async (tx) => {
      const { experimentId } = await tx.addExperiment({ experimentName: 'e' });
      const run = await tx.addRun({
        experimentId,
        runName: 'r',
        runStatus: 'running',
      });
      await tx.addLogs(
        run.runId,
        [1, 2, 3, 4, 5].map((number) => ({ type: 'log', number, values: {} })),
      );
      return run;
    });
    const logs = store.getLogs({ runId });
    await logs.next();
    await expect(
      store.withTransaction((tx) =>
        tx.addExperiment({ experimentName: 'meanwhile' }),
      ),
    ).resolves.toMatchObject({ experimentName: 'meanwhile' });
    const rest = await fromAsync(logs);
    expect(rest).toHaveLength(4);
    await store.close();
  });

  it('pages through every log of unnamed runs', async () => {
    const store = await SQLiteDataStore.open(':memory:', {
      selectQueryLimit: 2,
    });
    await store.withTransaction(async (tx) => {
      const { experimentId } = await tx.addExperiment({ experimentName: 'e' });
      for (const runName of [null, null, 'named']) {
        const run = await tx.addRun({
          experimentId,
          runName,
          runStatus: 'running',
        });
        await tx.addLogs(
          run.runId,
          [1, 2, 3].map((number) => ({ type: 'log', number, values: {} })),
        );
      }
    });
    const logs = await fromAsync(store.getLogs());
    expect(logs.map((log) => [log.runName, log.number])).toEqual([
      [null, 1],
      [null, 2],
      [null, 3],
      [null, 1],
      [null, 2],
      [null, 3],
      ['named', 1],
      ['named', 2],
      ['named', 3],
    ]);
    await store.close();
  });
});

describe.for([{ queryLimit: 10000 }, { queryLimit: 2 }])(
  `SQLiteStore#getLogs (selectQueryLimit: $queryLimit)`,
  ({ queryLimit }) => {
    type NewFixture = {
      queryLimit: number;
      context: {
        store: SQLiteDataStore;
        experiment1: ExperimentId;
        experiment2: ExperimentId;
        e1run1: RunId;
        e1run2: RunId;
        e2run1: RunId;
        logs: LogId[];
      };
    };

    const it = baseIt.extend<NewFixture>({
      queryLimit: async ({}, use) => use(queryLimit),
      context: async ({ queryLimit }, use) => {
        vi.useFakeTimers({ now: new Date('2025-01-01T00:00:01Z') });
        let store = await SQLiteDataStore.open(':memory:', {
          selectQueryLimit: queryLimit,
        });
        let e1 = await store.withTransaction((tx) =>
          tx.addExperiment({ experimentName: 'experiment-1' }),
        );
        let e2 = await store.withTransaction((tx) =>
          tx.addExperiment({ experimentName: 'experiment-2' }),
        );
        let e1r1 = await store.withTransaction((tx) =>
          tx.addRun({
            runName: 'run1',
            runStatus: 'running',
            experimentId: e1.experimentId,
          }),
        );
        let e1r2 = await store.withTransaction((tx) =>
          tx.addRun({
            runName: 'run2',
            runStatus: 'running',
            experimentId: e1.experimentId,
          }),
        );
        let e2r1 = await store.withTransaction((tx) =>
          tx.addRun({
            runName: 'run1',
            runStatus: 'running',
            experimentId: e2.experimentId,
          }),
        );
        const logs: LogId[] = [];
        let res = await store.withTransaction((tx) =>
          tx.addLogs(e1r1.runId, [
            { type: 'log1', number: 1, values: { data: [1, 'a'] } },
            { type: 'log1', number: 2, values: { data: [2, 'b'] } },
          ]),
        );
        logs.push(...res.map((l) => l.logId));
        res = await store.withTransaction((tx) =>
          tx.addLogs(e1r2.runId, [
            { type: 'log1', number: 1, values: { message: 'hola', bar: null } },
            { type: 'log2', number: 2, values: { x: 12, foo: false } },
          ]),
        );
        logs.push(...res.map((l) => l.logId));
        res = await store.withTransaction((tx) =>
          tx.addLogs(e2r1.runId, [
            { type: 'log2', number: 1, values: { x: 20, y: 2, foo: true } },
          ]),
        );
        logs.push(...res.map((l) => l.logId));
        res = await store.withTransaction((tx) =>
          tx.addLogs(e1r1.runId, [
            { type: 'log3', number: 3, values: { x: 25, y: 0, bar: '' } },
          ]),
        );
        logs.push(...res.map((l) => l.logId));
        vi.useRealTimers();
        await use({
          store,
          experiment1: e1.experimentId,
          experiment2: e2.experimentId,
          e1run1: e1r1.runId,
          e1run2: e1r2.runId,
          e2run1: e2r1.runId,
          logs,
        });
        store.close();
      },
    });

    it('returns the logs in order of experimentName, runName, and ascending number', async ({
      expect,
      context: { store },
    }) => {
      await expect(fromAsync(store.getLogs())).resolves.toMatchSnapshot();
    });

    it('ignores missing logs', async ({
      expect,
      context: { e2run1, store },
    }) => {
      await store.withTransaction((tx) =>
        tx.addLogs(e2run1, [
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
        ]),
      );
      await store.withTransaction((tx) =>
        tx.addLogs(e2run1, [
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
        ]),
      );
      await expect(fromAsync(store.getLogs())).resolves.toMatchSnapshot();
    });

    it('filters logs of a particular type', async ({
      expect,
      context: { store },
    }) => {
      await expect(
        fromAsync(store.getLogs({ logType: 'log1' })),
      ).resolves.toMatchSnapshot();
      await expect(
        fromAsync(store.getLogs({ logType: 'log2' })),
      ).resolves.toMatchSnapshot();
    });

    it('filters logs from a particular experiment', async ({
      expect,
      context: { store, experiment1, experiment2 },
    }) => {
      await expect(
        fromAsync(store.getLogs({ experimentId: experiment1 })),
      ).resolves.toMatchSnapshot();
      await expect(
        fromAsync(store.getLogs({ experimentId: experiment2 })),
      ).resolves.toMatchSnapshot();
    });

    it('filters logs from a particular run', async ({
      expect,
      context: { store },
    }) => {
      await expect(
        fromAsync(store.getLogs({ runName: 'run1' })),
      ).resolves.toMatchSnapshot();
      await expect(
        fromAsync(store.getLogs({ runName: 'run2' })),
      ).resolves.toMatchSnapshot();
    });

    it('filters logs by ids', async ({ expect, context: { store, logs } }) => {
      await expect(
        fromAsync(store.getLogs({ logId: logs.slice(1, 4) })),
      ).resolves.toMatchSnapshot();
      await expect(
        fromAsync(store.getLogs({ logId: logs[3] })),
      ).resolves.toEqual([
        {
          experimentId: '1',
          experimentName: 'experiment-1',
          logId: logs[3],
          number: 2,
          runId: '2',
          runName: 'run2',
          runStatus: 'running',
          type: 'log2',
          values: { foo: false, x: 12 },
        },
      ]);
    });

    it('filters logs by run, experiment, and type all at once', async ({
      expect,
      context: { experiment1, store, e1run2 },
    }) => {
      await expect(
        fromAsync(
          store.getLogs({ experimentId: experiment1, logType: 'log2' }),
        ),
      ).resolves.toEqual([
        {
          experimentId: experiment1,
          experimentName: 'experiment-1',
          logId: '4',
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
            logType: 'log1',
            runName: 'run1',
          }),
        ),
      ).resolves.toMatchSnapshot();
    });

    it('returns an empty array when no log matches the filter', async ({
      expect,
      context: { experiment2, store },
    }) => {
      await expect(
        fromAsync(
          store.getLogs({ experimentId: experiment2, logType: 'log1' }),
        ),
      ).resolves.toEqual([]);
      await expect(
        fromAsync(store.getLogs({ experimentName: 'do not exist' })),
      ).resolves.toEqual([]);
      await expect(
        fromAsync(store.getLogs({ runName: 'do not exist' })),
      ).resolves.toEqual([]);
      await expect(
        fromAsync(store.getLogs({ logType: 'do not exist' })),
      ).resolves.toEqual([]);
    });

    it('returns an empty array when the filter includes an empty array', async ({
      expect,
      context: { experiment1, store },
    }) => {
      await expect(
        fromAsync(store.getLogs({ experimentName: [] })),
      ).resolves.toEqual([]);
      await expect(fromAsync(store.getLogs({ logType: [] }))).resolves.toEqual(
        [],
      );
      await expect(fromAsync(store.getLogs({ runName: [] }))).resolves.toEqual(
        [],
      );
      // The server relies on this to show a session without runs nothing.
      await expect(fromAsync(store.getLogs({ runId: [] }))).resolves.toEqual(
        [],
      );
      await expect(store.getRuns({ runId: [] })).resolves.toEqual([]);
      await expect(
        fromAsync(
          store.getLogs({
            experimentName: [],
            runName: 'run1',
            logType: 'log1',
          }),
        ),
      ).resolves.toEqual([]);
      await expect(
        fromAsync(
          store.getLogs({
            experimentId: experiment1,
            runName: [],
            logType: 'log1',
          }),
        ),
      ).resolves.toEqual([]);

      await expect(
        fromAsync(
          store.getLogs({
            experimentId: experiment1,
            runName: 'runName',
            logType: [],
          }),
        ),
      ).resolves.toEqual([]);
    });

    it('returns logs added after canceling logs', async ({
      expect,
      context: { store, experiment2, e2run1 },
    }) => {
      await store.withTransaction((tx) =>
        tx.cancelLogsAfter(e2run1, { after: 1 }),
      );
      await store.withTransaction((tx) =>
        tx.addLogs(e2run1, [
          { type: 'log3', number: 2, values: { x: 25, y: 0, foo: true } },
        ]),
      );
      await expect(
        fromAsync(
          store.getLogs({ experimentId: experiment2, runName: 'run1' }),
        ),
      ).resolves.toMatchSnapshot();
    });

    it('does not return canceled logs', async ({
      expect,
      context: { experiment1, e1run2, store },
    }) => {
      let logs = await fromAsync(store.getLogs({ runId: e1run2 }));
      await store.withTransaction((tx) =>
        tx.cancelLogsAfter(e1run2, { after: 1 }),
      );
      await expect(
        fromAsync(store.getLogs({ runId: e1run2 })),
      ).resolves.toEqual([
        {
          experimentId: experiment1,
          experimentName: 'experiment-1',
          number: 1,
          logId: logs[0]!.logId,
          runId: e1run2,
          runName: 'run2',
          runStatus: 'running',
          type: 'log1',
          values: { bar: null, message: 'hola' },
        },
      ]);
      await store.withTransaction((tx) =>
        tx.cancelLogsAfter(e1run2, { after: 0 }),
      );
      await expect(
        fromAsync(store.getLogs({ runId: e1run2 })),
      ).resolves.toEqual([]);
    });

    it('returns logs overwriting canceled logs', async ({
      expect,
      context: { store, e1run2, experiment1 },
    }) => {
      await store.withTransaction((tx) =>
        tx.addLogs(e1run2, [
          { type: 'log1', number: 3, values: { x: 5 } },
          { type: 'log1', number: 4, values: { x: 6 } },
        ]),
      );
      let logs = await fromAsync(store.getLogs({ runId: e1run2 }));
      expect(logs).toHaveLength(4);
      await store.withTransaction((tx) =>
        tx.cancelLogsAfter(e1run2, { after: 1 }),
      );
      await expect(
        fromAsync(store.getLogs({ runId: e1run2 })),
      ).resolves.toHaveLength(1);
      await store.withTransaction((tx) =>
        tx.addLogs(e1run2, [
          { type: 'overwriting', number: 2, values: { x: 1 } },
          { type: 'overwriting', number: 3, values: { x: 2 } },
        ]),
      );
      await expect(
        fromAsync(
          store.getLogs({ experimentId: experiment1, runName: 'run2' }),
        ),
      ).resolves.toMatchSnapshot();
    });
  },
);
