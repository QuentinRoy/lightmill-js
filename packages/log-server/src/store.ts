import fs from 'node:fs/promises';
import path from 'node:path';
import * as url from 'node:url';
import SQLiteDB from 'better-sqlite3';
import {
  Kysely,
  FileMigrationProvider,
  Migrator,
  SqliteDialect,
  CamelCasePlugin,
  DeduplicateJoinsPlugin,
  InsertObject,
  GeneratedAlways,
  ColumnType,
} from 'kysely';
import { JsonObject } from 'type-fest';
import loglevel, { LogLevelDesc } from 'loglevel';
import { groupBy, last, pick } from 'remeda';
import { arrayify } from './utils.js';

const __dirname = url.fileURLToPath(new URL('.', import.meta.url));
const migrationFolder = path.join(__dirname, 'db-migrations');

export type Store = Omit<SQLiteStore, 'migrateDatabase' | 'close'>;

// We use ColumnType to prevent the column from being updated.
type RunTable = {
  runId: ColumnType<string, string, never>;
  experimentId: ColumnType<string, string, never>;
  status: 'running' | 'completed' | 'canceled';
};
type LogSequenceTable = {
  sequenceId: GeneratedAlways<number>;
  experimentId: ColumnType<string, string, never>;
  runId: ColumnType<string, string, never>;
  sequenceNumber: ColumnType<number, number, never>;
  start: ColumnType<number, number, never>;
};
type logTable = {
  logId: GeneratedAlways<number>;
  sequenceId: ColumnType<number, number, never>;
  logNumber: ColumnType<number, number, never>;
  // Logs with no types are used to fill in missing log numbers.
  type?: string;
};
type RunLogView = {
  logId: ColumnType<number, never, never>;
  experimentId: ColumnType<string, never, never>;
  runId: ColumnType<string, never, never>;
  sequenceId: ColumnType<number, never, never>;
  logNumber: ColumnType<number, never, never>;
  sequenceNumber: ColumnType<number, never, never>;
  // Logs with no types are used to fill in missing log numbers.
  type?: ColumnType<string, never, never>;
};
type LogValueTable = {
  logId: ColumnType<number, number, never>;
  name: ColumnType<string, string, never>;
  value: ColumnType<string, string, never>;
};
type Database = {
  run: RunTable;
  logSequence: LogSequenceTable;
  log: logTable;
  runLogView: RunLogView;
  logValue: LogValueTable;
};

export class SQLiteStore {
  #db: Kysely<Database>;
  #selectQueryLimit: number;

  constructor(
    db: string,
    {
      logLevel = loglevel.getLevel(),
      selectQueryLimit = 1000,
    }: { logLevel?: LogLevelDesc; selectQueryLimit?: number } = {},
  ) {
    const logger = loglevel.getLogger('store');
    logger.setLevel(logLevel);
    this.#selectQueryLimit = selectQueryLimit;
    this.#db = new Kysely({
      dialect: new SqliteDialect({ database: new SQLiteDB(db) }),
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

  async addRun({
    runId,
    experimentId,
  }: {
    runId: string;
    experimentId: string;
  }) {
    return this.#db.transaction().execute(async (trx) => {
      let result = await trx
        .insertInto('run')
        .values({ runId, experimentId, status: 'running' })
        .returning(['runId', 'experimentId'])
        .executeTakeFirstOrThrow()
        .catch((e) => {
          if (
            e instanceof Error &&
            'code' in e &&
            (e.code === 'SQLITE_CONSTRAINT_PRIMARYKEY' ||
              e.code === 'SQLITE_CONSTRAINT_UNIQUE')
          ) {
            throw new StoreError(
              `run "${runId}" already exists for experiment "${experimentId}".`,
              'RUN_EXISTS',
              e,
            );
          }
          throw e;
        });
      await trx
        .insertInto('logSequence')
        .values({ ...result, sequenceNumber: 1, start: 1 })
        .execute();
      return result;
    });
  }

  async resumeRun({
    runId,
    experimentId,
    resumeFrom,
  }: {
    runId: string;
    experimentId: string;
    resumeFrom: number;
  }) {
    return this.#db.transaction().execute(async (trx) => {
      let resumedRunResult = await trx
        .updateTable('run')
        .set({ status: 'running' })
        .where((eb) =>
          eb.and([
            eb('runId', '=', runId),
            eb('experimentId', '=', experimentId),
            eb('status', '<>', 'completed'),
          ]),
        )
        .returning(['run.runId', 'run.experimentId'])
        .execute();
      if (resumedRunResult.length === 0) {
        throw new StoreError(
          `Cannot resume run "${runId}" for experiment "${experimentId}".`,
          'RUN_NOT_FOUND',
        );
      }
      if (resumedRunResult.length > 1) {
        throw new Error(
          `SQL query returned more than one row for run "${runId}" for experiment "${experimentId}".`,
        );
      }
      let { lastSeqNumber, firstMissingLogNumber, lastLogNumber } = await trx
        .selectFrom('logSequence as seq')
        .leftJoin('runLogView as log', (join) =>
          join
            .onRef('log.runId', '=', 'seq.runId')
            .onRef('log.experimentId', '=', 'seq.experimentId'),
        )
        .where((eb) =>
          eb.and([
            eb('seq.experimentId', '=', experimentId),
            eb('seq.runId', '=', runId),
          ]),
        )
        .select((eb) => [
          eb.fn.max('seq.sequenceNumber').as('lastSeqNumber'),
          eb.fn
            .max('log.logNumber')
            .filterWhere('log.type', 'is not', null)
            .as('lastLogNumber'),
          eb.fn
            .min('log.logNumber')
            .filterWhere('log.type', 'is', null)
            .as('firstMissingLogNumber'),
        ])
        .executeTakeFirstOrThrow();
      if (lastSeqNumber == null) {
        throw new Error(
          `Could not find a sequence for run "${runId}" for experiment "${experimentId}".`,
        );
      }
      let minResumeFrom = 1;
      if (firstMissingLogNumber != null) {
        minResumeFrom = firstMissingLogNumber;
      } else if (lastLogNumber != null) {
        minResumeFrom = lastLogNumber + 1;
      }
      if (minResumeFrom < resumeFrom) {
        throw new StoreError(
          `Cannot resume run "${runId}" for experiment "${experimentId}" from log number ${resumeFrom} because the minimum is ${minResumeFrom}.`,
          'INVALID_LOG_NUMBER',
        );
      }
      return trx
        .insertInto('logSequence')
        .values({
          runId,
          experimentId,
          sequenceNumber: lastSeqNumber + 1,
          start: resumeFrom,
        })
        .returning(['runId', 'experimentId'])
        .executeTakeFirstOrThrow();
    });
  }

  async getRun(experimentId: string, runId: string) {
    return this.#db
      .selectFrom('run')
      .where('experimentId', '=', experimentId)
      .where('runId', '=', runId)
      .select(['runId', 'experimentId', 'status'])
      .executeTakeFirst();
  }

  async setRunStatus(
    experimentId: string,
    runId: string,
    status: 'completed' | 'canceled',
  ) {
    await this.#db
      .updateTable('run')
      .where('experimentId', '=', experimentId)
      .where('runId', '=', runId)
      .where('status', '=', 'running')
      .set({ status })
      // We need to return something or else the query will not fail if nothing
      // is updated.
      .returning(['runId', 'experimentId', 'status'])
      .executeTakeFirstOrThrow(
        () =>
          new StoreError(
            `Cannot set status of run "${runId}" for experiment "${experimentId}".`,
            'RUN_NOT_FOUND',
          ),
      );
  }

  async addLogs(
    experimentId: string,
    runId: string,
    logs: Array<{
      type: string;
      number: number;
      values: JsonObject;
    }>,
  ) {
    if (logs.length === 0) return;
    await this.#db.transaction().execute(async (trx) => {
      let { start, sequenceId, maxLogNumber } = await trx
        .selectFrom('logSequence as seq')
        .having((eb) =>
          eb.and([
            eb('seq.experimentId', '=', experimentId),
            eb('seq.runId', '=', runId),
            eb('seq.sequenceNumber', '=', eb.fn.max('seq.sequenceNumber')),
          ]),
        )
        .groupBy(['seq.experimentId', 'seq.runId'])
        .leftJoin('log', 'log.sequenceId', 'seq.sequenceId')
        .select((eb) => [
          'seq.sequenceId',
          'seq.start',
          eb.fn.max('log.logNumber').as('maxLogNumber'),
        ])
        .executeTakeFirstOrThrow(
          () =>
            new StoreError(
              `Cannot add logs to run "${runId}" for experiment "${experimentId}".`,
              'RUN_NOT_FOUND',
            ),
        );
      let indexedNewLogs = groupBy(logs, (log) => log.number);
      let newLogNumbers = logs.map((log) => log.number);
      let insertStartNumber = Math.min(
        ...newLogNumbers,
        maxLogNumber == null ? start : maxLogNumber + 1,
      );
      let insertEndNumber = Math.max(...newLogNumbers);

      // Start by updating existing logs.
      let logRows = new Array<InsertObject<Database, 'log'>>();
      // Add new logs and fill in missing logs.
      for (let nb = insertStartNumber; nb <= insertEndNumber; nb++) {
        let logs = indexedNewLogs[nb] ?? [];
        if (logs.length > 0) {
          // It is forbidden for two logs to have the same number, but if that
          // happens, the database should be the one to complain.
          logRows.push(
            ...logs.map(({ type, number }) => ({
              sequenceId,
              type,
              logNumber: number,
            })),
          );
        } else if (maxLogNumber == null || nb > maxLogNumber) {
          // If the log number is greater than maxLogNumber, there is a missing
          // log. We need to add it to the database.
          logRows.push({ sequenceId, logNumber: nb });
        }
      }
      await trx
        .deleteFrom('log')
        .where((eb) =>
          eb.and([
            eb('sequenceId', '=', sequenceId),
            eb('logNumber', 'in', newLogNumbers),
            eb('type', 'is', null),
          ]),
        )
        .execute();
      let dbLogs = await trx
        .insertInto('log')
        .values(logRows)
        .returning(['logId', 'logNumber', 'type'])
        .execute()
        .catch((e) => {
          if (
            e instanceof Error &&
            'code' in e &&
            (e.code === 'SQLITE_CONSTRAINT_PRIMARYKEY' ||
              e.code === 'SQLITE_CONSTRAINT_UNIQUE')
          ) {
            throw new StoreError(
              `Cannot add log: duplicated log number in the sequence.`,
              'LOG_NUMBER_EXISTS_IN_SEQUENCE',
              e,
            );
          }
          throw e;
        });

      // Map the log values to the log ids. We cannot rely on the order of
      // dbLogs because it is not guaranteed to be the same as the order of
      // the logs we inserted.
      let logValues = dbLogs
        .filter((l) => l.type != null)
        .flatMap((dbLog) => {
          // We know there is only one log with this number because of the
          // loop above.
          let values = indexedNewLogs[dbLog.logNumber][0].values;
          return deconstructValues(values, { logId: dbLog.logId });
        });
      if (logValues.length > 0) {
        await trx.insertInto('logValue').values(logValues).execute();
      }
    });
  }

  async getLogValueNames(filter: LogFilter = {}) {
    let result = await this.#db
      .selectFrom('logValue')
      .innerJoin('runLogView as log', 'log.logId', 'logValue.logId')
      .$if(filter.experimentId != null, (qb) =>
        qb.where('log.experimentId', 'in', arrayify(filter.experimentId, true)),
      )
      .$if(filter.runId != null, (qb) =>
        qb.where('log.runId', 'in', arrayify(filter.runId, true)),
      )
      .$if(filter.type != null, (qb) =>
        qb.where('log.type', 'in', arrayify(filter.type, true)),
      )
      .select('logValue.name')
      .orderBy('name')
      .distinct()
      .execute();
    return result.map((it) => it.name);
  }

  async getLogSummary(
    // It does not make sense to get the summary of multiple experiments or
    // runs, so we do not allow it.
    filter: LogFilter & { experimentId: string; runId: string },
  ): Promise<
    Array<{ type: string; count: number; pending: number; lastNumber: number }>
  > {
    let result = await this.#db
      .selectFrom('runLogView as log')
      .innerJoin('logSequence as seq', 'seq.sequenceId', 'log.sequenceId')
      .where((eb) =>
        eb.and([
          eb('seq.experimentId', '=', filter.experimentId),
          eb('seq.runId', '=', filter.runId),
          eb('log.type', 'is not', null),
        ]),
      )
      .$if(filter.type != null, (qb) =>
        qb.where('log.type', 'in', arrayify(filter.type, true)),
      )
      .leftJoin(
        ({ selectFrom }) =>
          selectFrom('runLogView')
            .where('type', 'is', null)
            .select((eb) => [
              'sequenceId',
              eb.fn.min('logNumber').as('logNumber'),
            ])
            .groupBy('sequenceId')
            .as('firstMissing'),
        (join) => join.onRef('log.sequenceId', '=', 'firstMissing.sequenceId'),
      )
      .select((eb) => [
        'log.type',
        eb.fn
          .countAll()
          .filterWhere(
            eb.or([
              eb('firstMissing.logNumber', 'is', null),
              eb('log.logNumber', '<', eb.ref('firstMissing.logNumber')),
            ]),
          )
          .as('count'),
        // In theory any logs from a run with no missing logs should not
        // be counted because missing.first will be null so the filter will
        // be unknown, so the log will not be included.
        eb.fn
          .countAll()
          .filterWhere('log.logNumber', '>', eb.ref('firstMissing.logNumber'))
          .as('pending'),
        eb.fn
          .max('log.logNumber')
          .filterWhere(
            eb.or([
              eb('firstMissing.logNumber', 'is', null),
              eb('log.logNumber', '<', eb.ref('firstMissing.logNumber')),
            ]),
          )
          .as('lastNumber'),
      ])
      .groupBy('type')
      .orderBy('type')
      .$narrowType<{ type: string }>()
      .execute();
    return result.map(({ pending, count, lastNumber, type }) => {
      return {
        type,
        pending: Number(pending),
        count: Number(count),
        lastNumber,
      };
    });
  }

  async *#getLogValues(filter: LogFilter) {
    let lastRow: {
      number: number;
      logId: number;
      experimentId: string;
      runId: string;
    } | null = null;
    let isFirst = true;
    let isDone = false;
    while (!isDone) {
      let result = await this.#db
        .selectFrom('runLogView as l')
        .innerJoin('logValue as v', 'l.logId', 'v.logId')
        .$if(filter.experimentId != null, (qb) =>
          qb.where('l.experimentId', 'in', arrayify(filter.experimentId, true)),
        )
        .$if(filter.runId != null, (qb) =>
          qb.where('l.runId', 'in', arrayify(filter.runId, true)),
        )
        .$if(filter.type != null, (qb) =>
          qb.where('l.type', 'in', arrayify(filter.type, true)),
        )
        .$if(!isFirst, (qb) => {
          if (lastRow === null) throw new Error('lastRow is null');
          return qb
            .where('l.experimentId', '>=', lastRow.experimentId)
            .where('l.runId', '>=', lastRow.runId)
            .where('l.logNumber', '>', lastRow.number);
        })
        .where('l.type', 'is not', null)
        .select([
          'l.experimentId as experimentId',
          'l.runId as runId',
          'l.logId as logId',
          'l.type as type',
          'l.logNumber as number',
          'v.name',
          'v.value',
        ])
        .$narrowType<{ type: string }>()
        .orderBy('experimentId')
        .orderBy('runId')
        .orderBy('number')
        .limit(this.#selectQueryLimit)
        .execute();
      isFirst = false;
      lastRow = last(result) ?? null;
      isDone = lastRow == null;
      yield* result;
    }
  }

  async *getLogs(filter: LogFilter = {}): AsyncGenerator<Log> {
    const logValuesIterator = this.#getLogValues(filter);

    let first = await logValuesIterator.next();
    if (first.done) return;
    let currentValues = [first.value];

    function getLogFromCurrentValues() {
      return {
        ...pick(currentValues[0], ['experimentId', 'runId', 'number', 'type']),
        values: reconstructValues(currentValues),
      };
    }

    for await (let logValue of logValuesIterator) {
      let logFirst = currentValues[0];
      if (logValue.logId !== logFirst.logId) {
        yield getLogFromCurrentValues();
        currentValues = [logValue];
      } else {
        currentValues.push(logValue);
      }
    }

    yield getLogFromCurrentValues();
  }

  async migrateDatabase() {
    let migrator = new Migrator({
      db: this.#db,
      provider: new FileMigrationProvider({
        fs,
        path,
        migrationFolder,
      }),
    });
    return migrator.migrateToLatest();
  }

  async close() {
    await this.#db.destroy();
  }
}

function deconstructValues(
  data: JsonObject,
): Array<{ name: string; value: string }>;
function deconstructValues<P extends Record<string, unknown>>(
  data: JsonObject,
  patch: P,
): Array<P & { name: string; value: string }>;
function deconstructValues(
  data: JsonObject,
  patch?: Record<string, unknown>,
): Array<JsonObject & { name: string; value: string }> {
  return Object.entries(data).map(([name, value]) => ({
    ...patch,
    name,
    value: JSON.stringify(value),
  }));
}

function reconstructValues(
  data: Array<{ name: string; value: string }>,
): JsonObject {
  let values: JsonObject = {};
  for (let { name, value } of data) {
    values[name] = JSON.parse(value);
  }
  return values;
}

export type LogFilter = {
  type?: string | string[];
  runId?: string | string[];
  experimentId?: string | string[];
};

export type Log = {
  experimentId: string;
  runId: string;
  number: number;
  type: string;
  values: JsonObject;
};

type StoreErrorCode =
  | 'RUN_EXISTS'
  | 'LOG_NUMBER_EXISTS_IN_SEQUENCE'
  | 'INVALID_LOG_NUMBER'
  | 'RUN_NOT_FOUND'
  | 'RUN_HAS_ENDED';
export class StoreError extends Error {
  code: StoreErrorCode;
  cause?: Error;
  constructor(message: string, code: StoreErrorCode, cause?: Error) {
    super(message);
    this.name = 'StoreError';
    this.code = code;
    this.cause = cause;
  }
}
