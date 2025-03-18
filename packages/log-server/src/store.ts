import SQLiteDB from 'better-sqlite3';
import {
  CamelCasePlugin,
  ColumnType,
  DeduplicateJoinsPlugin,
  FileMigrationProvider,
  GeneratedAlways,
  InsertObject,
  Kysely,
  Migrator,
  sql,
  SqliteDialect,
} from 'kysely';
import loglevel, { LogLevelDesc } from 'loglevel';
import fs from 'node:fs/promises';
import path from 'node:path';
import * as url from 'node:url';
import { groupBy, last, pick } from 'remeda';
import {
  JsonObject,
  ReadonlyDeep,
  Simplify,
  Tagged,
  UnionToIntersection,
} from 'type-fest';
import { arrayify, firstStrict, removePrefix, startsWith } from './utils.js';

const DEFAULT_SELECT_QUERY_LIMIT = 1_000_000;

const __dirname = url.fileURLToPath(new URL('.', import.meta.url));
const migrationFolder = path.join(__dirname, 'db-migrations');

export type Store = Omit<SQLiteStore, 'migrateDatabase' | 'close'>;

export type RunId = Tagged<string, 'RunId'>;
export type ExperimentId = Tagged<string, 'ExperimentId'>;
export type LogId = Tagged<string, 'LogId'>;

type DbRunId = Tagged<number, 'RunId'>;
type DbExperimentId = Tagged<number, 'ExperimentId'>;
type DbLogId = Tagged<number, 'LogId'>;
type DbLogSequenceId = Tagged<number, 'LogSequenceId'>;

type ExperimentTable = {
  experimentId: GeneratedAlways<DbExperimentId>;
  experimentName: ColumnType<string, string, never>;
  // We use ColumnType to indicate that the column cannot be updated.
  experimentCreatedAt: ColumnType<string, string, never>;
};
const runStatuses = [
  'idle',
  'running',
  'completed',
  'canceled',
  'interrupted',
] as const;
export type RunStatus = (typeof runStatuses)[number];
type RunTable = {
  runId: GeneratedAlways<DbRunId>;
  experimentId: ColumnType<DbExperimentId, DbExperimentId, never>;
  runName?: ColumnType<string, string, never>;
  runStatus: RunStatus;
  runCreatedAt: ColumnType<string, string, never>;
};
type LogSequenceTable = {
  sequenceId: GeneratedAlways<DbLogSequenceId>;
  runId: ColumnType<DbRunId, number, never>;
  sequenceNumber: ColumnType<number, number, never>;
  start: ColumnType<number, number, never>;
};
type LogTable = {
  logId: GeneratedAlways<DbLogId>;
  sequenceId: ColumnType<DbLogSequenceId, DbLogSequenceId, never>;
  logNumber: ColumnType<number, number, never>;
  // Logs with no types are used to fill in missing log numbers.
  canceledBy?: ColumnType<number, never, never>;
  logType?: string;
  logValues?: ColumnType<JsonObject, JsonObject, never>;
};
type RunLogView = {
  experimentId: ColumnType<DbExperimentId, never, never>;
  experimentName: ColumnType<string, never, never>;
  runId: ColumnType<DbRunId, never, never>;
  runName: ColumnType<string, never, never>;
  runStatus: ColumnType<RunStatus, never, never>;
  logId: ColumnType<DbLogId, never, never>;
  logNumber: ColumnType<number, never, never>;
  logType?: ColumnType<string, never, never>;
  logValues?: ColumnType<JsonObject, never, never>;
};
type LogPropertyNameTable = {
  logId: ColumnType<DbLogId, number, never>;
  logPropertyName: ColumnType<string, string, never>;
};
type Database = {
  experiment: ExperimentTable;
  run: RunTable;
  logSequence: LogSequenceTable;
  log: LogTable;
  runLogView: RunLogView;
  logPropertyName: LogPropertyNameTable;
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

  async addExperiment({ experimentName }: { experimentName: string }) {
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
          throw new StoreError(
            `Experiment ${experimentName} already exists`,
            'EXPERIMENT_EXISTS',
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

  async getExperiments(filter: ExperimentFilter = {}) {
    const { experimentId, experimentName } = parseExperimentFilter(filter);
    const result = await this.#db
      .selectFrom('experiment')
      .$if(experimentId != null, (qb) =>
        qb.where('experimentId', 'in', experimentId as DbExperimentId[]),
      )
      .$if(experimentName != null, (qb) =>
        qb.where('experimentName', 'in', experimentName as string[]),
      )
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
    runName?: string;
    experimentId: ExperimentId;
    runStatus?: RunStatus | undefined;
  }) {
    return this.#db.transaction().execute(async (trx) => {
      let result = await trx
        .insertInto('run')
        .values({
          runName,
          experimentId: toDbId(experimentId),
          runStatus,
          runCreatedAt: new Date().toISOString(),
        })
        .returningAll()
        .executeTakeFirstOrThrow()
        .catch((e) => {
          if (
            e instanceof SQLiteDB.SqliteError &&
            e.code === 'SQLITE_CONSTRAINT_TRIGGER' &&
            e.message.includes(
              'another run with the same name for the same experiment exists and is not canceled',
            )
          ) {
            throw new StoreError(
              `A run named "${runName}" already exists for experiment ${experimentId}.`,
              'RUN_EXISTS',
              { cause: e },
            );
          }
          throw e;
        });
      await trx
        .insertInto('logSequence')
        .values({ runId: result.runId, sequenceNumber: 1, start: 1 })
        .execute();
      return {
        ...result,
        runId: fromDbId(result.runId),
        runCreatedAt: new Date(result.runCreatedAt),
      };
    });
  }

  async resumeRun(runId: RunId, { from: resumeFrom }: { from: number }) {
    const dbRunId = toDbId(runId);
    return this.#db.transaction().execute(async (trx) => {
      await trx
        .updateTable('run')
        .set({ runStatus: 'running' })
        .where('runId', '=', dbRunId)
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
        .where((eb) => eb('seq.runId', '=', dbRunId))
        .select((eb) => [
          eb.fn.max('seq.sequenceNumber').as('lastSeqNumber'),
          eb.fn
            .max('log.logNumber')
            .filterWhere('log.logType', 'is not', null)
            .as('lastLogNumber'),
          eb.fn
            .min('log.logNumber')
            .filterWhere('log.logType', 'is', null)
            .as('firstMissingLogNumber'),
        ])
        .executeTakeFirstOrThrow(
          () => new Error(`Could not find a sequence for run ${runId}.`),
        );
      let minResumeFrom = 1;
      if (firstMissingLogNumber != null) {
        minResumeFrom = firstMissingLogNumber;
      } else if (lastLogNumber != null) {
        minResumeFrom = lastLogNumber + 1;
      }
      if (minResumeFrom < resumeFrom) {
        throw new StoreError(
          `Cannot resume run ${runId} from log number ${resumeFrom} because the minimum is ${minResumeFrom}.`,
          'INVALID_LOG_NUMBER',
        );
      }
      await trx
        .insertInto('logSequence')
        .values({
          runId: dbRunId,
          sequenceNumber: lastSeqNumber + 1,
          start: resumeFrom,
        })
        .returning(['runId'])
        .executeTakeFirstOrThrow();
    });
  }

  async getRuns(filter: RunFilter = {}) {
    const { experimentName, runName, runStatus, runId, experimentId } =
      parseRunFilter(filter);
    const runs = await this.#db
      .selectFrom('run')
      .$if(filter.runName != null, (qb) =>
        qb.where('runName', 'in', runName as NonNullable<typeof runName>),
      )
      .$if(filter.experimentId != null, (qb) =>
        qb.where(
          'experimentId',
          'in',
          experimentId as NonNullable<typeof experimentId>,
        ),
      )
      .$if(filter.experimentName != null, (qb) =>
        qb
          .leftJoin('experiment', 'run.experimentId', 'experiment.experimentId')
          .where(
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
      .select([
        'run.runId',
        'run.experimentId',
        'run.runName',
        'run.runStatus',
        'run.runCreatedAt',
      ])
      .execute();
    return runs.map((run) => ({
      ...run,
      runId: fromDbId(run.runId),
      experimentId: fromDbId(run.experimentId),
      runCreatedAt: new Date(run.runCreatedAt),
    }));
  }

  async setRunStatus(runId: RunId, status: Exclude<RunStatus, 'idle'>) {
    const dbRunId = toDbId(runId);
    await this.#db
      .updateTable('run')
      .where('runId', '=', dbRunId)
      .set({ runStatus: status })
      // We need to return something or else the query will not fail if nothing
      // is updated.
      .returning(['runName', 'experimentId', 'runStatus'])
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
            `Cannot update status of run ${runId} because the run is completed or canceled`,
            'RUN_HAS_ENDED',
            { cause: e },
          );
        }
        throw e;
      });
  }

  async addLogs(
    runId: RunId,
    logs: Array<{ type: string; number: number; values: JsonObject }>,
  ) {
    const dbRunId = toDbId(runId);
    if (logs.length === 0) return;
    await this.#db.transaction().execute(async (trx) => {
      let { start, sequenceId, maxLogNumber } = await trx
        .selectFrom('logSequence as seq')
        .having((eb) =>
          eb.and([
            eb('seq.runId', '=', dbRunId),
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
            ...logs.map(({ type, number, values }) => ({
              sequenceId,
              logType: type,
              logValues: json(values),
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
            eb('logType', 'is', null),
          ]),
        )
        .execute();
      let dbLogs = await trx
        .insertInto('log')
        .values(logRows)
        .returning(['logId', 'logNumber', 'logType'])
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
              { cause: e },
            );
          }
          throw e;
        });

      // Map the log values to the log ids. We cannot rely on the order of
      // dbLogs because it is not guaranteed to be the same as the order of
      // the logs we inserted.
      let logValues = dbLogs
        .filter((l) => l.logType != null)
        .flatMap((dbLog) => {
          // We know there is only one log with this number because of the
          // loop above.
          let logsForNumber = indexedNewLogs[dbLog.logNumber];
          if (logsForNumber == null) {
            throw new Error('Unexpected log number');
          }
          let values = firstStrict(logsForNumber).values;
          return Object.keys(values).map((logPropertyName) => ({
            logId: dbLog.logId,
            logPropertyName,
          }));
        });
      if (logValues.length > 0) {
        await trx.insertInto('logPropertyName').values(logValues).execute();
      }
    });
  }

  async getLogValueNames(filter: LogFilter = {}) {
    const { experimentName, runName, type, runStatus, runId, experimentId } =
      parseLogFilter(filter);
    let result = await this.#db
      .selectFrom('logPropertyName as lpn')
      .innerJoin('runLogView as l', 'l.logId', 'lpn.logId')
      .$if(experimentName != null, (qb) =>
        qb.where(
          'l.experimentName',
          'in',
          experimentName as NonNullable<typeof experimentName>,
        ),
      )
      .$if(experimentId != null, (qb) =>
        qb.where(
          'l.experimentId',
          'in',
          experimentId as NonNullable<typeof experimentId>,
        ),
      )
      .$if(runName != null, (qb) =>
        qb.where('l.runName', 'in', runName as NonNullable<typeof runName>),
      )
      .where('l.logType', 'is not', null)
      .$if(type != null, (qb) =>
        qb.where('l.logType', 'in', type as NonNullable<typeof type>),
      )
      .$if(runStatus != null, (qb) =>
        qb.where(
          'l.runStatus',
          'in',
          runStatus as NonNullable<typeof runStatus>,
        ),
      )
      .$if(runId != null, (qb) =>
        qb.where('l.runId', 'in', runId as NonNullable<typeof runId>),
      )
      .select('lpn.logPropertyName')
      .orderBy('logPropertyName')
      .distinct()
      .execute();
    return result.map((it) => it.logPropertyName);
  }

  async getLogSummary(
    runId: RunId,
    // It does not make sense to get the summary of multiple experiments or
    // runs, so we do not allow it.
    { type }: Pick<LogFilter, 'type'> = {},
  ): Promise<
    Array<{ type: string; count: number; pending: number; lastNumber: number }>
  > {
    const dbRunId = toDbId(runId);
    let typeFilter = parseLogFilter({ type }).type;
    let result = await this.#db
      .selectFrom('runLogView as lv')
      .where((eb) =>
        eb.and([
          eb('lv.runId', '=', dbRunId),
          eb('lv.logType', 'is not', null),
        ]),
      )
      .$if(typeFilter != null, (qb) =>
        qb.where(
          'lv.logType',
          'in',
          typeFilter as NonNullable<typeof typeFilter>,
        ),
      )
      .leftJoin(
        ({ selectFrom }) =>
          selectFrom('runLogView')
            .where('logType', 'is', null)
            .select((eb) => [eb.fn.min('logNumber').as('logNumber'), 'runId'])
            .groupBy('runId')
            .as('firstMissing'),
        (join) => join.onRef('lv.runId', '=', 'firstMissing.runId'),
      )
      .select((eb) => [
        'lv.logType',
        eb.fn
          .countAll()
          .filterWhere(
            eb.or([
              eb('firstMissing.logNumber', 'is', null),
              eb('lv.logNumber', '<', eb.ref('firstMissing.logNumber')),
            ]),
          )
          .as('count'),
        // In theory any logs from a run with no missing logs should not
        // be counted because missing.first will be null so the filter will
        // be unknown, so the log will not be included.
        eb.fn
          .countAll()
          .filterWhere('lv.logNumber', '>', eb.ref('firstMissing.logNumber'))
          .as('pending'),
        eb.fn
          .max('lv.logNumber')
          .filterWhere(
            eb.or([
              eb('firstMissing.logNumber', 'is', null),
              eb('lv.logNumber', '<', eb.ref('firstMissing.logNumber')),
            ]),
          )
          .as('lastNumber'),
      ])
      .groupBy('logType')
      .orderBy('logType')
      .$narrowType<{ logType: string }>()
      .execute();
    return result.map(({ pending, count, lastNumber, logType }) => {
      return {
        type: logType,
        pending: Number(pending),
        count: Number(count),
        lastNumber,
      };
    });
  }
  async *getLogs(filter: LogFilter = {}): AsyncGenerator<Log> {
    let parsedFilter = parseLogFilter(filter);
    let lastRow: {
      number: number;
      logId: number;
      experimentName: string;
      runName: string;
    } | null = null;
    let isFirst = true;
    while (isFirst || lastRow != null) {
      let result = await this.#db
        .selectFrom('runLogView as l')
        .$if(parsedFilter.runStatus != null, (qb) =>
          qb.where('l.runStatus', 'in', parsedFilter.runStatus!),
        )
        .$if(parsedFilter.experimentId != null, (qb) =>
          qb.where('l.experimentId', 'in', parsedFilter.experimentId!),
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
          qb.where('l.logType', 'in', parsedFilter.type!),
        )
        .where((wb) =>
          wb.and([
            wb('l.logType', 'is not', null),
            wb('l.logValues', 'is not', null),
          ]),
        )
        .select((eb) => [
          'l.experimentId as experimentId',
          'l.experimentName as experimentName',
          'l.runId as runId',
          'l.runName as runName',
          'l.runStatus as runStatus',
          'l.logId as logId',
          'l.logType as type',
          'l.logNumber as number',
          eb.ref('l.logValues', '->').key('$').$castTo<string>().as('values'),
        ])
        // We filtered out logs with no type, so we can safely narrow the type.
        // This needs to come after the select or it will not work.
        .$narrowType<{ type: string }>()
        .orderBy('experimentName')
        .orderBy('runName')
        .orderBy('logNumber')
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
                eb('logNumber', '>', lastRow.number),
              ]),
            ]);
          }),
        )
        .execute();
      isFirst = false;
      lastRow = last(result) ?? null;
      for (const logResult of result) {
        yield {
          ...pick(logResult, [
            'experimentName',
            'runName',
            'runStatus',
            'number',
            'type',
          ]),
          values: JSON.parse(logResult.values),
          experimentId: fromDbId(logResult.experimentId),
          runId: fromDbId(logResult.runId),
          logId: fromDbId(logResult.logId),
        };
      }
    }
  }

  async migrateDatabase() {
    let migrator = new Migrator({
      db: this.#db,
      provider: new FileMigrationProvider({ fs, path, migrationFolder }),
    });
    return migrator.migrateToLatest();
  }

  async close() {
    await this.#db.destroy();
  }
}

type IdsMap = Record<DbExperimentId, ExperimentId> &
  Record<DbRunId, RunId> &
  Record<DbLogId, LogId>;
type ReverseIdsMap = UnionToIntersection<
  keyof IdsMap extends infer K
    ? K extends PropertyKey
      ? IdsMap extends Record<K, infer V extends PropertyKey>
        ? Record<V, K>
        : never
      : never
    : never
>;

function fromDbId<I extends keyof IdsMap>(experimentId: I) {
  return experimentId.toString() as IdsMap[I];
}
function toDbId<I extends keyof ReverseIdsMap>(id: I) {
  let parsedId = parseInt(id);
  if (Number.isNaN(parsedId)) {
    return -1 as ReverseIdsMap[I];
  }
  return parsedId as ReverseIdsMap[I];
}

function parseExperimentFilter(experimentFilter: ExperimentFilter) {
  return {
    experimentName:
      experimentFilter.experimentName == null
        ? undefined
        : arrayify(experimentFilter.experimentName),
    experimentId:
      experimentFilter.experimentId == null
        ? undefined
        : arrayify(experimentFilter.experimentId).map(toDbId),
  };
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
    ...parseExperimentFilter(runFilter),
    runName:
      runFilter.runName == null ? undefined : arrayify(runFilter.runName),
    runId:
      runFilter.runId == null
        ? undefined
        : arrayify(runFilter.runId).map(toDbId),
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
    firstStrict(runStatusFilterArray).startsWith('-') ? runStatuses : undefined,
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
  experimentId: ExperimentId;
  experimentName: string;
  runId: RunId;
  runName: string;
  runStatus: RunStatus;
  logId: LogId;
  number: number;
  type: string;
  values: JsonObject;
};

const storeErrorCodeList = [
  'EXPERIMENT_EXISTS',
  'RUN_EXISTS',
  'LOG_NUMBER_EXISTS_IN_SEQUENCE',
  'INVALID_LOG_NUMBER',
  'RUN_NOT_FOUND',
  'RUN_HAS_ENDED',
] as const;
type StoreErrorCode = (typeof storeErrorCodeList)[number];

export class StoreError extends ErrorWithCodes(storeErrorCodeList) {
  constructor(message: string, code: StoreErrorCode, options?: ErrorOptions) {
    super(message, code, options);
    this.name = 'StoreError';
  }
}

function ErrorWithCodes<const Code extends string>(codes: readonly Code[]) {
  class ErrorWithCodes extends Error {
    code: Code;
    constructor(message: string, code: Code, options?: ErrorOptions) {
      super(message, options);
      this.code = code;
    }
  }
  const storeErrorCodeMap = Object.fromEntries(
    codes.map((code) => [code, code] as const),
  );
  Object.assign(ErrorWithCodes, storeErrorCodeMap);
  return ErrorWithCodes as typeof ErrorWithCodes & { [K in Code]: K };
}

export type RunFilter = Simplify<
  ReadonlyDeep<{
    runStatus?:
    runName?: string | string[] | undefined;
      | RunStatus
      | RunStatus[]
      | `-${RunStatus}`
      | `-${RunStatus}`[]
      | undefined;
    runId?: RunId | RunId[] | undefined;
  }> &
    ExperimentFilter
>;

export type LogFilter = RunFilter &
  ReadonlyDeep<{ type?: string | string[] | undefined }>;

function json<T>(value: T) {
  return sql<T>`jsonb(${JSON.stringify(value)})`;
}
