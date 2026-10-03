// The class has a `[Symbol.asyncDispose]` method, and a consumer's own `lib`
// may not include the library that declares the symbol. `preserve` keeps this
// line in the emitted declarations.
/// <reference lib="esnext.disposable" preserve="true" />
import SQLiteDB from 'better-sqlite3';
import type { Store as ExpressSessionStore } from 'express-session';
import {
  CamelCasePlugin,
  DeduplicateJoinsPlugin,
  FileMigrationProvider,
  Kysely,
  Migrator,
  sql,
  SqliteDialect,
} from 'kysely';
import loglevel, { type LogLevelDesc } from 'loglevel';
import fs from 'node:fs/promises';
import path from 'node:path';
import * as url from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { last, pick } from 'remeda';
import type { JsonValue } from 'type-fest';
import {
  type AllFilter,
  createQueryFilterAll,
  createQueryFilterExperiment,
  createQueryFilterRun,
  type ExperimentFilter,
  type RunFilter,
} from './data-filters.ts';
import { DataStoreError } from './data-store-errors.ts';
import {
  type Database,
  type DataStore,
  type DataStoreTransaction,
  type ExperimentId,
  type ExperimentRecord,
  fromDbId,
  type Log,
  type LogId,
  type NewLog,
  type RunId,
  type RunRecord,
  type RunStatus,
  toDbId,
} from './data-store.ts';
import { SessionStore } from './session-store.ts';

const __dirname = url.fileURLToPath(new URL('.', import.meta.url));

const DEFAULT_SELECT_QUERY_LIMIT = 1_000_000;
const MIGRATION_FOLDER = path.join(__dirname, 'db-migrations');
// Only `SQLiteDataStore.open` holds it, so nothing else can build a store that
// skipped the schema check.
const constructorKey = Symbol('SQLiteDataStore constructor key');

/**
 * SQLite-backed implementation of the Lightmill `DataStore` interface.
 */
export class SQLiteDataStore implements DataStore, AsyncDisposable {
  #db: Kysely<Database>;
  #selectQueryLimit: number;
  #sessionStore: SessionStore | undefined;
  #closing: Promise<void> | undefined;
  // Set when a rollback failed: the connection may still be in a transaction,
  // so nothing can be trusted until the store is closed.
  #poison: DataStoreError | undefined;

  // `private` only exists in TypeScript, but it is safe here: a JavaScript
  // caller hits the key check below and gets a TypeError.
  private constructor({
    key,
    db,
    selectQueryLimit,
  }: {
    key: symbol;
    db: Kysely<Database>;
    selectQueryLimit: number;
  }) {
    if (key !== constructorKey) {
      throw new TypeError(
        'SQLiteDataStore cannot be constructed directly. Use SQLiteDataStore.open.',
      );
    }
    this.#db = db;
    this.#selectQueryLimit = selectQueryLimit;
  }

  /**
   * Opens a SQLite datastore and checks that its schema is up to date. Run
   * `SQLiteDataStore.migrateDatabase` first on a new or outdated database.
   * An in-memory database (`':memory:'`) is always new, so it is migrated.
   *
   * @param dbPath Path to the SQLite database file.
   * @param options Datastore options.
   * @param options.logLevel Log level used for SQL and error logging.
   * @param options.selectQueryLimit Maximum rows returned by large select queries.
   * @throws {DataStoreError} `SCHEMA_OUTDATED` if migrations are pending.
   */
  static async open(
    dbPath: string,
    {
      logLevel = loglevel.getLevel(),
      selectQueryLimit = DEFAULT_SELECT_QUERY_LIMIT,
    }: { logLevel?: LogLevelDesc; selectQueryLimit?: number } = {},
  ): Promise<SQLiteDataStore> {
    const isMemory = dbPath === ':memory:';
    // Opening a missing file would create it empty, and a mistyped path would
    // silently leave an empty database behind.
    const kysely = createKysely(dbPath, logLevel, { fileMustExist: !isMemory });
    try {
      if (isMemory) {
        await migrate(kysely);
      } else {
        const pending = await getPendingMigrations(kysely);
        if (pending.length > 0) {
          throw new DataStoreError(
            `Database ${dbPath} has pending migrations (${pending.join(', ')}). Run SQLiteDataStore.migrateDatabase first.`,
            DataStoreError.SCHEMA_OUTDATED,
          );
        }
      }
    } catch (error) {
      // A failing close must not mask the error the caller needs.
      await kysely.destroy().catch(() => {});
      throw error;
    }
    return new SQLiteDataStore({
      key: constructorKey,
      db: kysely,
      selectQueryLimit,
    });
  }

  /**
   * Creates the database if needed and applies its pending migrations. Back
   * up an existing database first.
   *
   * @param dbPath Path to the SQLite database file.
   * @param options.logLevel Log level used for SQL and error logging.
   * @throws {DataStoreError} `MIGRATION_FAILED` if a migration fails.
   */
  static async migrateDatabase(
    dbPath: string,
    { logLevel = loglevel.getLevel() }: { logLevel?: LogLevelDesc } = {},
  ): Promise<void> {
    const kysely = createKysely(dbPath, logLevel);
    try {
      await migrate(kysely);
    } finally {
      await kysely.destroy();
    }
  }

  /**
   * The express-session store persisting sessions in this database, on this
   * data store's connection. Pass it to `LogServer` as `sessionStore`. Every
   * call returns the same store, which `close()` ends along with the data store.
   */
  getSessionStore(): ExpressSessionStore {
    this.#sessionStore ??= new SessionStore(this.#db);
    return this.#sessionStore;
  }

  getExperiments(filter?: ExperimentFilter) {
    return this.#read((queries) => queries.getExperiments(filter));
  }

  getRuns(filter?: RunFilter & Pick<ExperimentFilter, 'experimentName'>) {
    return this.#read((queries) => queries.getRuns(filter));
  }

  getLastLogs(filter?: AllFilter) {
    return this.#read((queries) => queries.getLastLogs(filter));
  }

  getLogValueNames(filter?: AllFilter) {
    return this.#read((queries) => queries.getLogValueNames(filter));
  }

  // Each page is an operation of its own, so a long export holds neither the
  // connection nor a lock between pulls.
  getLogs(filter: AllFilter = {}): AsyncGenerator<Log> {
    return streamLogs(
      (after) => this.#read((queries) => queries.getLogsPage(filter, after)),
      () => this.#assertAvailable(),
    );
  }

  /**
   * Transactions start with BEGIN IMMEDIATE, so the write lock is taken (and
   * SQLite's busy wait applies) up front: a deferred transaction that reads
   * and then writes fails at once when another process, like the CLI, holds
   * the lock. Kysely's own transactions begin deferred and mask a failed begin.
   *
   * The callback must only make calls on the transaction: the connection is
   * held until it settles, and Kysely's connection queue has no timeout, so one
   * that hangs blocks every other read and write, session writes included.
   */
  withTransaction<T>(fn: (tx: DataStoreTransaction) => Promise<T>): Promise<T> {
    return this.#operate(async (connection) => {
      try {
        await sql`BEGIN IMMEDIATE`.execute(connection);
      } catch (error) {
        throw mapBusyError(error);
      }
      const scope = createTransactionScope(
        new Queries(connection, this.#selectQueryLimit),
      );
      let value: T;
      try {
        value = await fn(scope.store);
        // A pending call can't be canceled, and the connection can't be
        // released under it.
        if (await scope.end()) {
          throw new TypeError(
            'A transaction call was still pending when the callback finished. Await every call made on the transaction.',
          );
        }
      } catch (error) {
        await scope.end();
        await this.#rollback(connection, error);
        throw error;
      }
      try {
        await sql`COMMIT`.execute(connection);
      } catch (commitError) {
        await this.#rollback(connection, commitError);
        const mapped = mapBusyError(commitError);
        if (mapped !== commitError) throw mapped;
        throw new DataStoreError(
          'Committing the transaction failed.',
          DataStoreError.TRANSACTION_COMMIT_FAILED,
          { cause: commitError },
        );
      }
      return value;
    });
  }

  async #rollback(
    connection: Kysely<Database>,
    originalError: unknown,
  ): Promise<void> {
    try {
      await sql`ROLLBACK`.execute(connection);
    } catch (rollbackError) {
      // A failing ROLLBACK means an I/O failure: probing or retrying would not
      // tell what was persisted.
      this.#poison = new DataStoreError(
        'Rolling back the transaction failed. What was persisted is unknown.',
        DataStoreError.TRANSACTION_ROLLBACK_FAILED,
        { cause: rollbackError, originalError },
      );
      throw this.#poison;
    }
  }

  #assertAvailable() {
    if (this.#closing != null) {
      throw new DataStoreError(
        'The store is closed.',
        DataStoreError.STORE_CLOSED,
      );
    }
    if (this.#poison != null) throw this.#poison;
  }

  // An operation holds the connection from start to end, so it is one turn in
  // Kysely's connection queue. It joins the queue as soon as it is admitted,
  // which is what lets close() wait for it by joining the queue behind it.
  async #operate<T>(
    run: (connection: Kysely<Database>) => Promise<T>,
  ): Promise<T> {
    this.#assertAvailable();
    try {
      return await this.#db.connection().execute(async (connection) => {
        // The rollback of a transaction ahead of this one may have failed while
        // this one waited, leaving the connection inside that transaction.
        if (this.#poison != null) throw this.#poison;
        return run(connection);
      });
    } catch (error) {
      throw mapBusyError(error);
    }
  }

  #read<T>(read: (queries: Queries) => Promise<T>): Promise<T> {
    return this.#operate((connection) =>
      read(new Queries(connection, this.#selectQueryLimit)),
    );
  }

  /**
   * Rejects new operations at once, waits for the admitted ones, then closes
   * the connection. Later calls return the first call's promise.
   */
  close(): Promise<void> {
    this.#closing ??= (async () => {
      // Kysely's destroy() does not wait for its connection queue, so wait for
      // a turn behind every admitted operation first.
      await this.#db.connection().execute(async () => {});
      await this.#db.destroy();
    })();
    return this.#closing;
  }

  /** Does what `close()` does, so `await using` can close the store. */
  [Symbol.asyncDispose](): Promise<void> {
    return this.close();
  }
}

/**
 * The queries behind both the store and its transactions. They know nothing
 * about transactions: whoever holds the Kysely instance decides.
 */
class Queries {
  #db: Kysely<Database>;
  #selectQueryLimit: number;

  constructor(db: Kysely<Database>, selectQueryLimit: number) {
    this.#db = db;
    this.#selectQueryLimit = selectQueryLimit;
  }

  async addExperiment({
    experimentName,
  }: {
    experimentName: string;
  }): Promise<ExperimentRecord> {
    let exp = await this.#db
      .insertInto('experiment')
      .values({ experimentName, experimentCreatedAt: new Date().toISOString() })
      .returningAll()
      .executeTakeFirstOrThrow()
      .catch((e) => {
        if (
          e instanceof SQLiteDB.SqliteError &&
          e.code === 'SQLITE_CONSTRAINT_UNIQUE'
        ) {
          throw new DataStoreError(
            `Experiment ${experimentName} already exists`,
            DataStoreError.EXPERIMENT_EXISTS,
            { cause: e },
          );
        }
        throw e;
      });
    return {
      ...exp,
      experimentId: fromDbId(exp.experimentId),
      experimentCreatedAt: new Date(exp.experimentCreatedAt),
    };
  }

  async getExperiments(
    filter: ExperimentFilter = {},
  ): Promise<ExperimentRecord[]> {
    const result = await this.#db
      .selectFrom('experiment')
      .$call(createQueryFilterExperiment(filter, 'experiment'))
      .selectAll()
      .execute();
    return result.map((exp) => ({
      ...exp,
      experimentId: fromDbId(exp.experimentId),
      experimentCreatedAt: new Date(exp.experimentCreatedAt),
    }));
  }

  async addRun({
    runName,
    experimentId,
    runStatus = 'idle',
  }: {
    runName?: string | null | undefined;
    experimentId: ExperimentId;
    runStatus?: RunStatus | undefined;
  }): Promise<RunRecord> {
    let result = await this.#db
      .insertInto('run')
      .values({
        runName: runName ?? undefined,
        experimentId: toDbId(experimentId),
        runStatus,
        runCreatedAt: new Date().toISOString(),
      })
      .returningAll()
      .executeTakeFirstOrThrow()
      .catch((e) => {
        if (!(e instanceof SQLiteDB.SqliteError)) {
          throw e;
        }
        if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') {
          // The only unique constraint on the run table is the one on the names
          // of the runs that are not canceled.
          throw new DataStoreError(
            `A run named "${runName}" already exists for experiment ${experimentId}.`,
            DataStoreError.RUN_EXISTS,
            { cause: e },
          );
        }
        if (e.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
          // Only the experimentId is a foreign key, so we can assume
          // that the experiment does not exist.
          throw new DataStoreError(
            `Experiment "${experimentId}" does not exist.`,
            DataStoreError.EXPERIMENT_NOT_FOUND,
            { cause: e },
          );
        }
        throw e;
      });
    await this.#db
      .insertInto('logSequence')
      .values({ runId: result.runId, sequenceNumber: 1, start: 1 })
      .execute();
    return {
      ...result,
      experimentId: fromDbId(result.experimentId),
      runId: fromDbId(result.runId),
      runCreatedAt: new Date(result.runCreatedAt),
      runName: result.runName ?? null,
      firstMissingLogNumber: null,
      lastLogNumber: 0,
    };
  }

  async cancelLogsAfter(
    runId: RunId,
    { after }: { after: number },
  ): Promise<void> {
    const dbRunId = toDbId(runId);
    const lastSequence = await this.#db
      .selectFrom('lastLogSequenceView')
      .where('runId', '=', dbRunId)
      .select('sequenceNumber')
      .executeTakeFirstOrThrow(
        () =>
          new DataStoreError(
            `No run found for id ${runId}`,
            DataStoreError.RUN_NOT_FOUND,
          ),
      );
    // An `after` above the run's last log number is refused by a trigger.
    await this.#db
      .insertInto('logSequence')
      .values({
        runId: dbRunId,
        sequenceNumber: lastSequence.sequenceNumber + 1,
        start: after + 1,
      })
      .execute();
  }

  async getRuns(
    // We currently rely on experimentName to decide whether to join the experiment table,
    // as it's the only ExperimentFilter property not in RunFilter. Using pick here (and below)
    // prevents subtle bugs where some filters might be applied only when experimentName is present.
    // If new properties are added to ExperimentFilter, this code will need updating.
    filter: RunFilter & Pick<ExperimentFilter, 'experimentName'> = {},
  ): Promise<RunRecord[]> {
    const runs = await this.#db
      .selectFrom('run')
      // Do not join if we do not need to.
      .$if(filter.experimentName != null, (qb) => {
        return qb
          .innerJoin(
            'experiment',
            'run.experimentId',
            'experiment.experimentId',
          )
          .$call(
            createQueryFilterExperiment(
              pick(filter, ['experimentName']),
              'experiment',
            ),
          );
      })
      .$call(createQueryFilterRun(filter, 'run'))
      .innerJoin(
        'lastLogSequenceView as lastSequence',
        'lastSequence.runId',
        'run.runId',
      )
      .orderBy('runCreatedAt', 'desc')
      .select([
        'run.runId',
        'run.experimentId',
        'run.runName',
        'run.runStatus',
        'run.runCreatedAt',
        'lastSequence.firstMissingLogNumber',
        'lastSequence.lastLogNumber',
      ])
      .execute();
    return runs.map((run) => ({
      ...run,
      runId: fromDbId(run.runId),
      runName: run.runName ?? null,
      experimentId: fromDbId(run.experimentId),
      runCreatedAt: new Date(run.runCreatedAt),
    }));
  }

  async setRunStatus(runId: RunId, status: RunStatus): Promise<void> {
    const dbRunId = toDbId(runId);
    await this.#db
      .updateTable('run')
      .where('runId', '=', dbRunId)
      .set({ runStatus: status })
      // We need to return something or else the query will not fail if nothing
      // is updated.
      .returning(['runName', 'experimentId', 'runStatus'])
      .executeTakeFirstOrThrow(() => {
        return new DataStoreError(
          `No run found for id ${runId}`,
          DataStoreError.RUN_NOT_FOUND,
        );
      })
      .catch((e) => {
        if (
          e instanceof SQLiteDB.SqliteError &&
          e.code === 'SQLITE_CONSTRAINT_UNIQUE'
        ) {
          // A canceled run coming back needs its name to still be free.
          throw new DataStoreError(
            `Cannot change the status of run ${runId} to ${status}: another run of its experiment has its name.`,
            DataStoreError.RUN_EXISTS,
            { cause: e },
          );
        }
        throw e;
      });
  }

  async addLogs(
    runId: RunId,
    logs: Array<NewLog>,
  ): Promise<Array<{ logId: LogId; created: boolean }>> {
    const dbRunId = toDbId(runId);
    if (logs.length === 0) return [];
    let { sequenceId } = await this.#db
      .selectFrom('lastLogSequenceView')
      .where('runId', '=', dbRunId)
      .select('sequenceId')
      .executeTakeFirstOrThrow(
        () =>
          new DataStoreError(
            `No run found for id ${runId}`,
            DataStoreError.RUN_NOT_FOUND,
          ),
      );
    const insertLogs = async (batch: typeof logs) =>
      batch.length === 0
        ? []
        : this.#db
            .insertInto('log')
            .values(
              batch.map((log) => ({
                sequenceId,
                logNumber: log.number,
                logType: log.type,
                logValues: json(log.values),
              })),
            )
            .returning(['logId', 'logNumber'])
            .execute();
    // Ids of the logs that were already stored (duplicates).
    let duplicateIds = new Map<number, number>();
    let dbLogs: Array<{ logId: number; logNumber: number }>;
    try {
      dbLogs = await insertLogs(logs);
    } catch (e) {
      if (
        !(
          e instanceof SQLiteDB.SqliteError &&
          (e.code === 'SQLITE_CONSTRAINT_PRIMARYKEY' ||
            e.code === 'SQLITE_CONSTRAINT_UNIQUE')
        )
      ) {
        throw e;
      }
      // The failed statement was rolled back, the transaction is still
      // usable.
      duplicateIds = await findDuplicateIds(this.#db, sequenceId, logs, e);
      dbLogs = await insertLogs(
        logs.filter((l) => !duplicateIds.has(l.number)),
      );
    }
    // We are working on a single run and log sequence, so all lognumbers should be unique.
    const logMap = new Map(duplicateIds);
    for (const log of dbLogs) logMap.set(log.logNumber, log.logId);
    // Map input logs to logs ids. We cannot rely on the order of
    // dbLogs because it is not guaranteed to be the same as the order of
    // the logs we inserted.
    const result = logs.map((log, index) => {
      const logId = logMap.get(log.number);
      if (logId == null) {
        throw new Error(
          `Log with number ${log.number} at index ${index} wasn't inserted`,
        );
      }
      return {
        logId,
        values: log.values,
        created: !duplicateIds.has(log.number),
      };
    });
    // Stored duplicates already have their property names.
    const logValues = result.flatMap(({ logId, values, created }) => {
      if (!created) return [];
      return Object.keys(values).map((logPropertyName) => ({
        logId,
        logPropertyName,
      }));
    });
    if (logValues.length > 0) {
      await this.#db.insertInto('logPropertyName').values(logValues).execute();
    }
    return result.map(({ logId, created }) => ({
      logId: fromDbId(logId),
      created,
    }));
  }

  async getLogValueNames(filter: AllFilter = {}): Promise<string[]> {
    let result = await this.#db
      .selectFrom('logPropertyName as lpn')
      .innerJoin('runLogView as l', 'l.logId', 'lpn.logId')
      .$call(createQueryFilterAll(filter, 'l'))
      .select('lpn.logPropertyName')
      .orderBy('logPropertyName')
      .distinct()
      .execute();
    return result.map((it) => it.logPropertyName);
  }

  async getLastLogs(
    filter: AllFilter = {},
  ): Promise<
    Array<{
      runId: RunId;
      logId: LogId;
      type: string;
      values: Record<string, unknown>;
      number: number;
    }>
  > {
    let result = await this.#db
      .with('lastLog', (db) =>
        db
          .selectFrom('runLogView as runLog')
          .$call(createQueryFilterAll(filter, 'runLog'))
          .innerJoin(
            'lastLogSequenceView as lastSequence',
            'lastSequence.runId',
            'runLog.runId',
          )
          // Logs above the last log number are stranded.
          .whereRef('runLog.logNumber', '<=', 'lastSequence.lastLogNumber')
          // SQLite takes bare columns from the row holding the max.
          .select((eb) => [
            'runLog.runId',
            'runLog.logId',
            eb.fn.max('runLog.logNumber').as('logNumber'),
          ])
          .groupBy(['runLog.runId', 'runLog.logType']),
      )
      .selectFrom('log')
      .innerJoin('lastLog as last', 'log.logId', 'last.logId')
      .select((eb) => [
        'last.runId',
        'log.logId',
        'log.logType as type',
        'log.logNumber as number',
        // logValues is a jsonb blob: `->` '$' makes SQLite return it as JSON text,
        // which Kysely can't infer, so the type is asserted for parseJsonObject.
        eb
          .ref('log.logValues', '->')
          .key('$')
          .$castTo<string>()
          .as('jsonValues'),
      ])
      .execute();

    return result.map(({ jsonValues, runId, logId, ...rest }) => {
      return {
        ...rest,
        runId: fromDbId(runId),
        logId: fromDbId(logId),
        values: parseJsonObject(jsonValues),
      };
    });
  }

  async getLogsPage(filter: AllFilter, after: Log | null): Promise<Log[]> {
    let query = this.#db
      .selectFrom('runLogView as l')
      .$call(createQueryFilterAll(filter, 'l'))
      .select((eb) => [
        'l.experimentId as experimentId',
        'l.experimentName as experimentName',
        'l.runId as runId',
        'l.runName as runName',
        'l.runStatus as runStatus',
        'l.logId as logId',
        'l.logType as type',
        'l.logNumber as number',
        // logValues is a jsonb blob: `->` '$' makes SQLite return it as JSON text,
        // which Kysely can't infer, so the type is asserted for parseJsonObject.
        eb.ref('l.logValues', '->').key('$').$castTo<string>().as('values'),
      ])
      .orderBy('experimentName')
      .orderBy('runName')
      .orderBy('logNumber')
      .limit(this.#selectQueryLimit);
    if (after != null) {
      query = query.where((eb) =>
        eb.or([
          eb('experimentName', '>', after.experimentName),
          eb.and([
            eb('experimentName', '=', after.experimentName),
            eb('runName', '>', after.runName),
          ]),
          eb.and([
            eb('experimentName', '=', after.experimentName),
            eb('runName', '=', after.runName),
            eb('logNumber', '>', after.number),
          ]),
        ]),
      );
    }
    const result = await query.execute();
    return result.map((logResult) => ({
      ...pick(logResult, [
        'experimentName',
        'runName',
        'runStatus',
        'number',
        'type',
      ]),
      values: parseJsonObject(logResult.values),
      experimentId: fromDbId(logResult.experimentId),
      runId: fromDbId(logResult.runId),
      logId: fromDbId(logResult.logId),
    }));
  }
}

// end() waits on `set`. The copy kept there settles without rejecting, so a
// failed call rejects only for its caller and end() still waits for it.
function track(set: Set<Promise<void>>, promise: Promise<unknown>) {
  const tracked: Promise<void> = promise.then(done, done);
  function done() {
    set.delete(tracked);
  }
  set.add(tracked);
}

/**
 * SQLITE_BUSY and SQLITE_LOCKED (and their extended codes) mean another
 * connection is in the way: the transaction can be tried again.
 */
export function mapBusyError(error: unknown): unknown {
  if (
    error instanceof SQLiteDB.SqliteError &&
    /^SQLITE_(BUSY|LOCKED)(_|$)/.test(error.code)
  ) {
    return new DataStoreError(
      'The transaction conflicted with another one, and nothing was persisted. Try again.',
      DataStoreError.TRANSACTION_CONFLICT,
      { cause: error },
    );
  }
  return error;
}

/**
 * `assertAvailable` runs when a pull resumes after a log: a page holds several
 * logs, and the pulls it serves must stop with the store or the transaction
 * too.
 */
async function* streamLogs(
  fetchPage: (after: Log | null) => Promise<Log[]>,
  assertAvailable: () => void,
): AsyncGenerator<Log> {
  let after: Log | null = null;
  do {
    const page: Log[] = await fetchPage(after);
    for (const log of page) {
      yield log;
      assertAvailable();
    }
    after = last(page) ?? null;
  } while (after != null);
}

/**
 * The store as the transaction callback sees it. `end()` closes it: calls
 * (and generator pulls) made afterwards reject, and the ones still pending are
 * waited for.
 */
function createTransactionScope(queries: Queries) {
  let ended = false;
  const pending = new Set<Promise<void>>();
  const assertActive = () => {
    if (ended) {
      throw new DataStoreError(
        'The transaction has ended: its store cannot be used after the callback finished.',
        DataStoreError.TRANSACTION_ENDED,
      );
    }
  };
  const call = <T>(run: () => Promise<T>): Promise<T> => {
    const promise = (async () => {
      assertActive();
      try {
        return await run();
      } catch (error) {
        throw mapBusyError(error);
      }
    })();
    track(pending, promise);
    return promise;
  };
  const store: DataStoreTransaction = {
    addExperiment: (params) => call(() => queries.addExperiment(params)),
    addRun: (params) => call(() => queries.addRun(params)),
    setRunStatus: (runId, status) =>
      call(() => queries.setRunStatus(runId, status)),
    cancelLogsAfter: (runId, params) =>
      call(() => queries.cancelLogsAfter(runId, params)),
    addLogs: (runId, logs) => call(() => queries.addLogs(runId, logs)),
    getExperiments: (filter) => call(() => queries.getExperiments(filter)),
    getRuns: (filter) => call(() => queries.getRuns(filter)),
    getLastLogs: (filter) => call(() => queries.getLastLogs(filter)),
    getLogValueNames: (filter) => call(() => queries.getLogValueNames(filter)),
    getLogs: (filter = {}) =>
      streamLogs(
        (after) => call(() => queries.getLogsPage(filter, after)),
        assertActive,
      ),
  };
  return {
    // The type has no withTransaction. This answers JavaScript callers.
    store: Object.assign(store, {
      withTransaction() {
        throw new TypeError('Transactions cannot be nested.');
      },
    }),
    async end() {
      ended = true;
      const hadPendingCalls = pending.size > 0;
      await Promise.all(pending);
      return hadPendingCalls;
    },
  };
}

function createKysely(
  dbPath: string,
  logLevel: LogLevelDesc,
  sqliteOptions: SQLiteDB.Options = {},
) {
  const logger = loglevel.getLogger('store');
  logger.setLevel(logLevel);
  return new Kysely<Database>({
    dialect: new SqliteDialect({
      database: new SQLiteDB(dbPath, sqliteOptions),
    }),
    log: (event) => {
      if (event.level === 'query') {
        logger.debug(event.query.sql, event.query.parameters);
      } else if (event.level === 'error') {
        logger.error(event.error);
      }
    },
    plugins: [new CamelCasePlugin(), new DeduplicateJoinsPlugin()],
  });
}

function createMigrator(db: Kysely<Database>) {
  return new Migrator({
    db,
    provider: new FileMigrationProvider({
      fs,
      path,
      migrationFolder: MIGRATION_FOLDER,
    }),
  });
}

async function getPendingMigrations(db: Kysely<Database>) {
  const migrations = await createMigrator(db).getMigrations();
  return migrations
    .filter(({ executedAt }) => executedAt == null)
    .map(({ name }) => name);
}

async function migrate(db: Kysely<Database>) {
  const result = await createMigrator(db).migrateToLatest();
  if (result.error != null && result.error instanceof Error) {
    throw new DataStoreError(
      `Database migration failed: ${result.error.message}`,
      DataStoreError.MIGRATION_FAILED,
      { cause: result.error },
    );
  } else if (result.error != null) {
    throw new DataStoreError(
      `Database migration failed: ${result.error}`,
      DataStoreError.MIGRATION_FAILED,
    );
  }
}

/**
 * Called after inserting `logs` hit a unique violation. A log that is already
 * stored with the same type and values (a resent one) is a duplicate, not a
 * conflict. Returns the ids of the duplicates by log number, and throws if any
 * log conflicts with a stored one.
 */
async function findDuplicateIds(
  trx: Kysely<Database>,
  sequenceId: number,
  logs: Array<NewLog>,
  cause: unknown,
) {
  // The unique constraint can't tell a repeat inside the batch from a stored
  // log, and a repeat is never a resend.
  const batchNumbers = new Set<number>();
  for (const log of logs) {
    if (batchNumbers.has(log.number)) {
      throw createLogNumberExistsError(cause, log.number);
    }
    batchNumbers.add(log.number);
  }
  const storedLogs = await trx
    .selectFrom('log')
    .where('sequenceId', '=', sequenceId)
    .where(
      'logNumber',
      'in',
      logs.map((l) => l.number),
    )
    .select((eb) => [
      'logId',
      'logNumber',
      'logType',
      // logValues is a jsonb blob: `->` '$' makes SQLite return it as JSON text,
      // which Kysely can't infer, so the type is asserted for parseJsonObject.
      eb.ref('logValues', '->').key('$').$castTo<string>().as('values'),
    ])
    .execute();
  const storedByNumber = new Map(storedLogs.map((l) => [l.logNumber, l]));
  const duplicateIds = new Map<number, number>();
  for (const log of logs) {
    const stored = storedByNumber.get(log.number);
    if (stored == null) continue;
    if (
      stored.logType !== log.type ||
      !isDeepStrictEqual(parseJsonObject(stored.values), log.values)
    ) {
      throw createLogNumberExistsError(cause, log.number);
    }
    duplicateIds.set(log.number, stored.logId);
  }
  return duplicateIds;
}

function createLogNumberExistsError(cause: unknown, logNumber: number) {
  return new DataStoreError(
    `Cannot add log: duplicated log number in the sequence.`,
    DataStoreError.LOG_NUMBER_EXISTS_IN_SEQUENCE,
    { cause, logNumber },
  );
}

function json<T>(value: T) {
  return sql<T>`jsonb(${JSON.stringify(value)})`;
}

function parseJsonObject(jsonString: string): Record<string, unknown> {
  let result: JsonValue = JSON.parse(jsonString);
  if (typeof result !== 'object' || result === null) {
    throw new Error('JSON is not an object');
  }
  if (result instanceof Array) {
    throw new Error('JSON is an array');
  }
  return result;
}
