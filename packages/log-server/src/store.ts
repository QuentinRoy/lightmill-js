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
import { groupBy, last } from 'remeda';
import { z } from 'zod';
import { arrayify, removePrefix, startsWith } from './utils.js';

const DEFAULT_SELECT_QUERY_LIMIT = 1000000;

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
  #selectQueryLimit: number;

  constructor(
    db: string,
    {
      logLevel = loglevel.getLevel(),
      selectQueryLimit = DEFAULT_SELECT_QUERY_LIMIT,
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
          return deconstructValues(values, { logId: dbLog.logId });
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

  async *#getLogValues(filter: LogFilter = {}) {
    let parsedFilter = parseLogFilter(filter);
    let lastRow: {
      logNumber: number;
      logId: number;
      experimentName: string;
      runName: string;
      name: string;
    } | null = null;
    let isFirst = true;
    let isDone = false;
    while (!isDone) {
      let query = this.#db
        .selectFrom('runLogView as l')
        .innerJoin('logValue as v', 'l.logId', 'v.logId')
        .$if(parsedFilter.runStatus != null, (qb) =>
          qb.where('l.runStatus', 'in', parsedFilter.runStatus!),
        )
        .$if(parsedFilter.experimentName != null, (qb) =>
          qb.where('l.experimentName', 'in', parsedFilter.experimentName!),
        )
        .$if(parsedFilter.runName != null, (qb) =>
          qb.where('l.runName', 'in', parsedFilter.runName!),
        )
        .$if(parsedFilter.runId != null, (qb) =>
          qb.where('l.runId', 'in', parsedFilter.runId!),
        )
        .$if(parsedFilter.type != null, (qb) =>
          qb.where('l.type', 'in', parsedFilter.type!),
        )
        .where('l.type', 'is not', null)
        .select([
          'l.experimentName as experimentName',
          'l.runName as runName',
          'l.runId as runId',
          'l.runStatus as runStatus',
          'l.logId as logId',
          'l.type as type',
          'l.logNumber as logNumber',
          'v.name as name',
          'v.value as value',
        ])
        // We filtered out logs with no type, so we can safely narrow the type.
        // This needs to come after the select or it will not work.
        .$narrowType<{ type: string }>()
        .orderBy('experimentName')
        .orderBy('runName')
        .orderBy('logNumber')
        .orderBy('name')
        .limit(this.#selectQueryLimit)
        .$if(!isFirst, (qb) =>
          qb.where((eb) => {
            if (lastRow === null) throw new Error('lastRow is null');
            return eb.or([
              eb('experimentName', '>', lastRow.experimentName),
              eb.and([
                eb('experimentName', '=', lastRow.experimentName),
                eb('runName', '>', lastRow.runName),
              ]),
              eb.and([
                eb('experimentName', '=', lastRow.experimentName),
                eb('runName', '=', lastRow.runName),
                eb('logNumber', '>', lastRow.logNumber),
              ]),
              eb.and([
                eb('experimentName', '=', lastRow.experimentName),
                eb('runName', '=', lastRow.runName),
                eb('logNumber', '=', lastRow.logNumber),
                eb('name', '>', lastRow.name),
              ]),
            ]);
          }),
        );
      let result = await query.execute();
      isFirst = false;
      lastRow = last(result) ?? null;
      isDone = lastRow == null;
      yield* result;
    }
  }

  async *getLogs(filter?: LogFilter): AsyncGenerator<Log> {
    const logValuesIterator = this.#getLogValues(filter);

    function getLogFromCurrentValues(): Log {
      let { experimentName, runName, logNumber, type, runId, runStatus } =
        currentValues[0];
      return {
        experimentName,
        runName,
        runId,
        runStatus,
        number: logNumber,
        type,
        values: reconstructValues(currentValues),
      };
    }

    let first = await logValuesIterator.next();
    if (first.done) return;
    let currentValues = [first.value];

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

/**
 * Parses a RunFilter object into its constituent parts with standardized array formats.
 *
 * Each filter field is converted to either undefined (if not provided) or an array of values.
 * The runStatus field is specially handled through parseRunStatusFilter to support inclusion/exclusion notation.
 *
 * @param runFilter - The filter criteria for runs including optional runName, experimentName, runId and runStatus
 * @returns Object containing processed versions of each filter field:
 *          - runName: Array of run names or undefined
 *          - experimentName: Array of experiment names or undefined
 *          - runId: Array of run IDs or undefined
 *          - runStatus: Array of RunStatus values after processing inclusion/exclusion rules
 */
function parseRunFilter(runFilter: RunFilter) {
  return {
    runName:
      runFilter.runName == null ? undefined : arrayify(runFilter.runName),
    experimentName:
      runFilter.experimentName == null
        ? undefined
        : arrayify(runFilter.experimentName),
    runId: runFilter.runId == null ? undefined : arrayify(runFilter.runId),
    runStatus: parseRunStatusFilter(runFilter.runStatus),
  };
}

/**
 * Parses a run status filter and converts it into an array of RunStatus values.
 * The filter can be a single RunStatus, an array of RunStatus values, or strings with a '-' prefix
 * to indicate exclusion.
 *
 * If a status is prefixed with '-', it is excluded from the final set of statuses.
 * If the first status begins with '-', the initial set includes all runStatuses, then removes the excluded ones.
 * Otherwise, the initial set is empty and only includes explicitly specified statuses.
 *
 * @param runStatusFilter - A RunStatus, array of RunStatus values, or strings with '-' prefix for exclusion
 * @returns Array of RunStatus values after applying inclusions/exclusions, or undefined if input is undefined
 */
function parseRunStatusFilter(runStatusFilter: RunFilter['runStatus']) {
  if (runStatusFilter == null) return undefined;
  const runStatusFilterArray = arrayify(runStatusFilter, true);
  if (runStatusFilterArray.length === 0) return [];
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

/**
 * Parses a LogFilter object by combining run filter parsing with log type filtering.
 *
 * Extends the parseRunFilter functionality to also handle the optional 'type' field
 * specific to log filtering. The type field is converted to an array format if provided.
 *
 * @param logFilter - The filter criteria for logs, extending RunFilter with an optional type field
 * @returns Object containing all parsed RunFilter fields plus:
 *          - type: Array of log types or undefined
 * @see {@link parseRunFilter}
 */
function parseLogFilter(logFilter: LogFilter) {
  return {
    ...parseRunFilter(logFilter),
    type: logFilter.type == null ? undefined : arrayify(logFilter.type),
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

const storeErrorCodes = [
  'RUN_EXISTS',
  'LOG_NUMBER_EXISTS_IN_SEQUENCE',
  'INVALID_LOG_NUMBER',
  'RUN_NOT_FOUND',
  'RUN_HAS_ENDED',
] as const;
type StoreErrorCode = (typeof storeErrorCodes)[number];
class StoreError extends Error {
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
const ExtendedStoreError = StoreError as typeof StoreError & {
  [key in StoreErrorCode]: key;
};
Object.assign(ExtendedStoreError, storeErrorCodes);
export { ExtendedStoreError as StoreError };
