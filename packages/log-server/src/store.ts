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
import { JsonObject, ReadonlyDeep } from 'type-fest';
import loglevel, { LogLevelDesc } from 'loglevel';
import { groupBy, omit } from 'remeda';
import { z } from 'zod';
import { arrayify, removePrefix, startsWith } from './utils.js';
import { JsonValue } from '../../log-api/dist/utils.js';

const __dirname = url.fileURLToPath(new URL('.', import.meta.url));
const migrationFolder = path.join(__dirname, 'db-migrations');

export type Store = Omit<SQLiteStore, 'migrateDatabase' | 'close'>;

const runStatuses = [
  'idle',
  'running',
  'completed',
  'canceled',
  'interrupted',
] as const;

export type RunStatus = (typeof runStatuses)[number];

export type RunFilter = ReadonlyDeep<{
  runName?: string | string[] | undefined;
  experimentName?: string | string[] | undefined;
  runStatus?:
    | RunStatus
    | RunStatus[]
    | `-${RunStatus}`
    | `-${RunStatus}`[]
    | undefined;
  runId?: RunId | RunId[] | undefined;
}>;

export type LogFilter = RunFilter &
  ReadonlyDeep<{
    type?: string | string[] | undefined;
  }>;

export const RunId = z.number().brand('RunId');
export type RunId = z.output<typeof RunId>;

// We use ColumnType to indicate that the column cannot be updated.
type RunTable = {
  runId: GeneratedAlways<RunId>;
  runName: ColumnType<string, string, never>;
  experimentName: ColumnType<string, string, never>;
  runStatus: RunStatus;
  runCreatedAt: ColumnType<string, string, never>;
};
type LogSequenceTable = {
  sequenceId: GeneratedAlways<number>;
  runId: ColumnType<RunId, RunId, never>;
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
  runId: ColumnType<number, never, never>;
  experimentName: ColumnType<string, never, never>;
  runName: ColumnType<string, never, never>;
  runStatus: ColumnType<RunStatus, never, never>;
  sequenceId: ColumnType<number, never, never>;
  sequenceNumber: ColumnType<number, never, never>;
  logId: ColumnType<number, never, never>;
  logNumber: ColumnType<number, never, never>;
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

  constructor(
    db: string,
    { logLevel = loglevel.getLevel() }: { logLevel?: LogLevelDesc } = {},
  ) {
    const logger = loglevel.getLogger('store');
    logger.setLevel(logLevel);
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
    runName,
    experimentName,
    runStatus = 'idle',
  }: {
    runName: string;
    experimentName: string;
    runStatus?: RunStatus | undefined;
  }) {
    return this.#db.transaction().execute(async (trx) => {
      let result = await trx
        .insertInto('run')
        .values({
          runName,
          experimentName,
          runStatus,
          runCreatedAt: new Date().toISOString(),
        })
        .returning(['runId', 'runName', 'experimentName', 'runStatus'])
        .executeTakeFirstOrThrow()
        .catch((e) => {
          if (
            e instanceof SQLiteDB.SqliteError &&
            e.code === 'SQLITE_CONSTRAINT_TRIGGER' &&
            e.message.includes(
              'Cannot insert run when another run with the same name and experiment name exists and is not canceled',
            )
          ) {
            throw new StoreError(
              `run "${runName}" already exists for experiment "${experimentName}".`,
              'RUN_EXISTS',
              e,
            );
          }
          throw e;
        });
      await trx
        .insertInto('logSequence')
        .values({ runId: result.runId, sequenceNumber: 1, start: 1 })
        .execute();
      return result;
    });
  }

  async resumeRun(runId: RunId, { from: resumeFrom }: { from: number }) {
    return this.#db.transaction().execute(async (trx) => {
      let { runName, experimentName } = await trx
        .updateTable('run')
        .set({ runStatus: 'running' })
        .where('runId', '=', runId)
        .returning(['run.experimentName', 'run.runName'])
        .executeTakeFirstOrThrow(() => {
          return new StoreError(
            `No run found for id ${runId}`,
            'RUN_NOT_FOUND',
          );
        });
      let { lastSeqNumber, firstMissingLogNumber, lastLogNumber } = await trx
        .selectFrom('logSequence as seq')
        .leftJoin('runLogView as log', (join) =>
          join.onRef('log.runId', '=', 'seq.runId'),
        )
        .where((eb) => eb('seq.runId', '=', runId))
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
        .executeTakeFirstOrThrow(
          () =>
            new Error(
              `Could not find a sequence for run "${runName}" of experiment "${experimentName}".`,
            ),
        );
      let minResumeFrom = 1;
      if (firstMissingLogNumber != null) {
        minResumeFrom = firstMissingLogNumber;
      } else if (lastLogNumber != null) {
        minResumeFrom = lastLogNumber + 1;
      }
      if (minResumeFrom < resumeFrom) {
        throw new StoreError(
          `Cannot resume run "${runName}" of experiment "${experimentName}" from log number ${resumeFrom} because the minimum is ${minResumeFrom}.`,
          'INVALID_LOG_NUMBER',
        );
      }
      await trx
        .insertInto('logSequence')
        .values({
          runId,
          sequenceNumber: lastSeqNumber + 1,
          start: resumeFrom,
        })
        .returning(['runId'])
        .executeTakeFirstOrThrow();
    });
  }

  async getRuns(filter: RunFilter = {}) {
    const { experimentName, runName, runStatus, runId } =
      parseRunFilter(filter);
    const runs = await this.#db
      .selectFrom('run')
      .$if(filter.runName != null, (qb) =>
        qb.where('runName', 'in', runName as NonNullable<typeof runName>),
      )
      .$if(filter.experimentName != null, (qb) =>
        qb.where(
          'experimentName',
          'in',
          experimentName as NonNullable<typeof experimentName>,
        ),
      )
      .$if(filter.runStatus != null, (qb) =>
        qb.where('runStatus', 'in', runStatus as NonNullable<typeof runStatus>),
      )
      .$if(filter.runId != null, (qb) =>
        qb.where('runId', 'in', runId as NonNullable<typeof runId>),
      )
      .orderBy('runCreatedAt', 'desc')
      .selectAll()
      .execute();
    return runs.map((run) => ({
      ...run,
      runCreatedAt: new Date(run.runCreatedAt),
    }));
  }

  async setRunStatus(runId: RunId, status: Exclude<RunStatus, 'idle'>) {
    await this.#db
      .updateTable('run')
      .where('runId', '=', runId)
      .set({ runStatus: status })
      // We need to return something or else the query will not fail if nothing
      // is updated.
      .returning(['runName', 'experimentName', 'runStatus'])
      .executeTakeFirstOrThrow(() => {
        return new StoreError(`No run found for id ${runId}`, 'RUN_NOT_FOUND');
      })
      .catch((e) => {
        if (
          e instanceof SQLiteDB.SqliteError &&
          e.code === 'SQLITE_CONSTRAINT_TRIGGER' &&
          e.message ===
            'Cannot update run status when the run is completed or canceled'
        ) {
          throw new StoreError(
            `Cannot update status of run "run1" for experiment "experiment" because the run is completed or canceled`,
            'RUN_HAS_ENDED',
            e,
          );
        }
        throw e;
      });
  }

  async addLogs(
    runId: RunId,
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
            eb('seq.runId', '=', runId),
            eb('seq.sequenceNumber', '=', eb.fn.max('seq.sequenceNumber')),
          ]),
        )
        .groupBy(['seq.runId'])
        .leftJoin('log', 'log.sequenceId', 'seq.sequenceId')
        .select((eb) => [
          'seq.sequenceId',
          'seq.start',
          eb.fn.max('log.logNumber').as('maxLogNumber'),
        ])
        .executeTakeFirstOrThrow(
          () => new StoreError(`No run found for id ${runId}`, 'RUN_NOT_FOUND'),
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
          return deconstructLog(values, { logId: dbLog.logId });
        });
      if (logValues.length > 0) {
        await trx.insertInto('logValue').values(logValues).execute();
      }
    });
  }

  async getLogValueNames(filter: LogFilter = {}) {
    const { experimentName, runName, type, runStatus, runId } =
      parseLogFilter(filter);
    let result = await this.#db
      .selectFrom('logValue')
      .innerJoin('runLogView as log', 'log.logId', 'logValue.logId')
      .$if(experimentName != null, (qb) =>
        qb.where(
          'log.experimentName',
          'in',
          experimentName as NonNullable<typeof experimentName>,
        ),
      )
      .$if(runName != null, (qb) =>
        qb.where('log.runName', 'in', runName as NonNullable<typeof runName>),
      )
      .where('log.type', 'is not', null)
      .$if(type != null, (qb) =>
        qb.where('log.type', 'in', type as NonNullable<typeof type>),
      )
      .$if(runStatus != null, (qb) =>
        qb.where(
          'log.runStatus',
          'in',
          runStatus as NonNullable<typeof runStatus>,
        ),
      )
      .$if(runId != null, (qb) =>
        qb.where('log.runId', 'in', runId as NonNullable<typeof runId>),
      )
      .select('logValue.name')
      .orderBy('name')
      .distinct()
      .execute();
    return result.map((it) => it.name);
  }

  async getLogSummary(
    runId: RunId,
    // It does not make sense to get the summary of multiple experiments or
    // runs, so we do not allow it.
    { type }: Pick<LogFilter, 'type'> = {},
  ): Promise<
    Array<{ type: string; count: number; pending: number; lastNumber: number }>
  > {
    let typeFilter = parseLogFilter({ type }).type;
    let result = await this.#db
      .selectFrom('runLogView as log')
      .innerJoin('logSequence as seq', 'seq.sequenceId', 'log.sequenceId')
      .where((eb) =>
        eb.and([eb('log.runId', '=', runId), eb('log.type', 'is not', null)]),
      )
      .$if(typeFilter != null, (qb) =>
        qb.where(
          'log.type',
          'in',
          typeFilter as NonNullable<typeof typeFilter>,
        ),
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

  async *getLogs(filter: LogFilter = {}): AsyncGenerator<Log> {
    // It would probably be better not to read everything at once because
    // this could be a lot of data. Instead we could read a few, yield, and
    // restart with the remaining. However until this becomes a problem, this
    // is good enough.
    const { experimentName, runName, type, runStatus, runId } =
      parseLogFilter(filter);
    let result = await this.#db
      .selectFrom('runLogView as l')
      .innerJoin('logValue as v', 'l.logId', 'v.logId')
      .$if(experimentName != null, (qb) => {
        return qb.where(
          'l.experimentName',
          'in',
          experimentName as NonNullable<typeof experimentName>,
        );
      })
      .$if(runName != null, (qb) => {
        return qb.where(
          'l.runName',
          'in',
          runName as NonNullable<typeof runName>,
        );
      })
      .where('l.type', 'is not', null)
      .$if(type != null, (qb) => {
        return qb.where('l.type', 'in', type as NonNullable<typeof type>);
      })
      .$if(runStatus != null, (qb) => {
        return qb.where(
          'l.runStatus',
          'in',
          runStatus as NonNullable<typeof runStatus>,
        );
      })
      .$if(runId != null, (qb) => {
        return qb.where('l.runId', 'in', runId as NonNullable<typeof runId>);
      })
      .select([
        'l.runId as runId',
        'l.runStatus as runStatus',
        'l.experimentName as experimentName',
        'l.runName as runName',
        'l.logId as logId',
        'l.type as type',
        'l.logNumber as number',
        'v.name as name',
        'v.value as value',
      ])
      .$narrowType<{ type: string }>()
      .orderBy('experimentName')
      .orderBy('runName')
      .orderBy('runId')
      .orderBy('number')
      .execute();

    let currentLogStart = 0;
    let lastRow = result[0];
    for (let i = 1; i < result.length; i++) {
      let thisRow = result[i];
      if (thisRow.logId !== lastRow.logId) {
        yield reconstructLog(
          result.slice(currentLogStart, i),
          omit(lastRow, ['value', 'name', 'logId']),
        );
        currentLogStart = i;
      }
      lastRow = thisRow;
    }
    if (currentLogStart < result.length) {
      yield reconstructLog(
        result.slice(currentLogStart, result.length),
        omit(lastRow, ['value', 'name', 'logId']),
      );
    }
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

function deconstructLog(
  data: JsonObject,
): Array<{ name: string; value: string }>;
function deconstructLog<P extends Record<string, unknown>>(
  data: JsonObject,
  patch: P,
): Array<P & { name: string; value: string }>;
function deconstructLog(
  data: JsonObject,
  patch?: Record<string, unknown>,
): Array<JsonObject & { name: string; value: string }> {
  return Object.entries(data).map(([name, value]) => ({
    ...patch,
    name,
    value: JSON.stringify(value),
  }));
}

function reconstructLog<N extends string>(
  slice: { name: N; value: string }[],
): { values: Partial<Record<N, JsonValue>> };
function reconstructLog<N extends string, P extends Record<string, unknown>>(
  slice: { name: N; value: string }[],
  patch: P,
): Omit<P, 'values'> & {
  values: string extends N
    ? Record<N, JsonValue>
    : Partial<Record<N, JsonValue>>;
};
function reconstructLog<N extends string>(
  slice: { name: N; value: string }[],
  patch?: Record<PropertyKey, unknown>,
) {
  let values: Partial<Record<N, JsonValue>> = {};
  for (let { name, value } of slice) {
    values[name] = JSON.parse(value);
  }
  return patch == null ? { values } : { ...patch, values };
}

function parseRunFilter(runFilter: RunFilter) {
  return {
    runName:
      runFilter.runName == null ? undefined : arrayify(runFilter.runName, true),
    experimentName:
      runFilter.experimentName == null
        ? undefined
        : arrayify(runFilter.experimentName, true),
    runId:
      runFilter.runId == null ? undefined : arrayify(runFilter.runId, true),
    runStatus: parseRunStatusFilter(runFilter.runStatus),
  };
}

function parseRunStatusFilter(runStatusFilter: RunFilter['runStatus']) {
  if (runStatusFilter == null) return undefined;
  const runStatusFilterArray = arrayify(runStatusFilter, true);
  const include = new Set<RunStatus>(
    runStatusFilterArray[0].startsWith('-') ? runStatuses : undefined,
  );
  for (let status of runStatusFilterArray) {
    if (startsWith(status, '-')) {
      include.delete(removePrefix(status, '-'));
    } else {
      include.add(status);
    }
  }
  return Array.from(include);
}

function parseLogFilter(logFilter: LogFilter) {
  return {
    ...parseRunFilter(logFilter),
    type: logFilter.type == null ? undefined : arrayify(logFilter.type, true),
  };
}

export type Log = {
  runId: number;
  runStatus: RunStatus;
  experimentName: string;
  runName: string;
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
    if (cause != null) {
      this.cause = cause;
    }
  }
}
