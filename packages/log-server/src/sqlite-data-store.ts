import SQLiteDB from 'better-sqlite3';
import {
  CamelCasePlugin,
  DeduplicateJoinsPlugin,
  FileMigrationProvider,
  type InsertObject,
  Kysely,
  Migrator,
  sql,
  SqliteDialect,
} from 'kysely';
import loglevel, { type LogLevelDesc } from 'loglevel';
import fs from 'node:fs/promises';
import path from 'node:path';
import * as url from 'node:url';
import { last, pick } from 'remeda';
import type { JsonObject, JsonValue } from 'type-fest';
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
  type ExperimentId,
  type ExperimentRecord,
  fromDbId,
  type Log,
  type LogId,
  type RunId,
  type RunRecord,
  type RunStatus,
  toDbId,
} from './data-store.ts';
import { getStrict } from './utils.ts';

const __dirname = url.fileURLToPath(new URL('.', import.meta.url));

const DEFAULT_SELECT_QUERY_LIMIT = 1_000_000;
const MIGRATION_FOLDER = path.join(__dirname, 'db-migrations');

export class SQLiteDataStore implements DataStore {
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
    return this.#db.transaction().execute(async (trx) => {
      let result = await trx
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
          if (
            e.code === 'SQLITE_CONSTRAINT_TRIGGER' &&
            e.message.includes(
              'another run with the same name for the same experiment exists and is not canceled',
            )
          ) {
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
      await trx
        .insertInto('logSequence')
        .values({ runId: result.runId, sequenceNumber: 1, start: 1 })
        .execute();
      return {
        ...result,
        experimentId: fromDbId(result.experimentId),
        runId: fromDbId(result.runId),
        runCreatedAt: new Date(result.runCreatedAt),
        runName: result.runName ?? null,
      };
    });
  }

  async resumeRun(
    runId: RunId,
    { after: resumeAfter }: { after: number },
  ): Promise<void> {
    const dbRunId = toDbId(runId);
    return this.#db.transaction().execute(async (trx) => {
      await trx
        .updateTable('run')
        .set({ runStatus: 'running' })
        .where('runId', '=', dbRunId)
        .executeTakeFirstOrThrow(() => {
          return new DataStoreError(
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
      if (minResumeFrom <= resumeAfter) {
        throw new DataStoreError(
          `Cannot resume run ${runId} after log number ${resumeAfter} because it would leave log number ${minResumeFrom} missing.`,
          'INVALID_LOG_NUMBER',
        );
      }
      await trx
        .insertInto('logSequence')
        .values({
          runId: dbRunId,
          sequenceNumber: lastSeqNumber + 1,
          start: resumeAfter + 1,
        })
        .returning(['runId'])
        .executeTakeFirstOrThrow();
    });
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
          e.code === 'SQLITE_CONSTRAINT_TRIGGER' &&
          e.message === 'Completed runs can only be canceled'
        ) {
          throw new DataStoreError(
            `Cannot change status of run ${runId} to ${status} because the run is completed and can only be canceled.`,
            DataStoreError.RUN_HAS_ENDED,
            { cause: e },
          );
        } else if (
          e instanceof SQLiteDB.SqliteError &&
          e.code === 'SQLITE_CONSTRAINT_TRIGGER' &&
          e.message === 'Cannot update run status when the run is canceled'
        ) {
          throw new DataStoreError(
            `Cannot update status of run ${runId} because the run is canceled.`,
            DataStoreError.RUN_HAS_ENDED,
            { cause: e },
          );
        }
        throw e;
      });
  }

  async addLogs(
    runId: RunId,
    logs: Array<{ type: string; number: number; values: JsonObject }>,
  ): Promise<{ logId: LogId }[]> {
    const dbRunId = toDbId(runId);
    if (logs.length === 0) return [];
    return this.#db.transaction().execute(async (trx) => {
      let { start, sequenceId, lastLogNumber } = await trx
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
          eb.fn.max('log.logNumber').as('lastLogNumber'),
        ])
        .executeTakeFirstOrThrow(
          () =>
            new DataStoreError(
              `No run found for id ${runId}`,
              DataStoreError.RUN_NOT_FOUND,
            ),
        );
      let newLogNumbers = logs.map((log) => log.number);
      let insertStartNumber = Math.min(
        ...newLogNumbers,
        lastLogNumber == null ? start : lastLogNumber + 1,
      );
      let insertEndNumber = Math.max(...newLogNumbers);

      // Prepopulating the array to insert with missing logs.
      let logRows: Array<InsertObject<Database, 'log'>> = Array.from(
        { length: insertEndNumber - insertStartNumber + 1 },
        (_v, i) => ({ sequenceId, logNumber: i + insertStartNumber }),
      );
      for (const log of logs) {
        let logToInsert = getStrict(logRows, log.number - insertStartNumber);
        // Sanity check.
        if (logToInsert.logNumber !== log.number) {
          throw new Error(
            `Log number mismatch: expected ${log.number}, got ${logToInsert.logNumber}`,
          );
        }
        if (logToInsert.logType != null) {
          throw new DataStoreError(
            `Cannot add log: duplicated log number in the sequence.`,
            DataStoreError.LOG_NUMBER_EXISTS_IN_SEQUENCE,
          );
        }
        logToInsert.logType = log.type;
        logToInsert.logValues = json(log.values);
      }
      let dbLogs = await trx
        .insertInto('log')
        .values(logRows)
        .onConflict((cb) =>
          cb
            .columns(['sequenceId', 'logNumber'])
            .doUpdateSet((ub) => ({
              logType: ub.ref('excluded.logType'),
              logValues: ub.ref('excluded.logValues'),
            })),
        )
        .returning(['logId', 'logNumber', 'logType'])
        .execute()
        .catch((e) => {
          if (
            e instanceof Error &&
            'code' in e &&
            (e.code === 'SQLITE_CONSTRAINT_PRIMARYKEY' ||
              e.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
              (e.code === 'SQLITE_CONSTRAINT_TRIGGER' &&
                (e.message === 'Cannot change log values once set' ||
                  e.message === 'Cannot change log type once set')))
          ) {
            throw new DataStoreError(
              `Cannot add log: duplicated log number in the sequence.`,
              DataStoreError.LOG_NUMBER_EXISTS_IN_SEQUENCE,
              { cause: e },
            );
          }
          throw e;
        });
      // We are working on a single run and log sequence, so all lognumbers should be unique.
      const logMap = new Map(dbLogs.map((log) => [log.logNumber, log.logId]));
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
        return { logId, values: log.values };
      });
      const logValues = result.flatMap(({ logId, values }) => {
        return Object.keys(values).map((logPropertyName) => ({
          logId,
          logPropertyName,
        }));
      });
      if (logValues.length > 0) {
        await trx.insertInto('logPropertyName').values(logValues).execute();
      }
      return result.map((l) => ({ logId: fromDbId(l.logId) }));
    });
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

  async getMissingLogs(
    filter: RunFilter & ExperimentFilter,
  ): Promise<{ runId: RunId; logNumber: number }[]> {
    const result = await this.#db
      .selectFrom('log')
      .innerJoin('logSequence', 'log.sequenceId', 'logSequence.sequenceId')
      .innerJoin('run', 'run.runId', 'logSequence.runId')
      .innerJoin('experiment', 'experiment.experimentId', 'run.experimentId')
      .where('log.logType', 'is', null)
      .$call(createQueryFilterRun(filter, 'run'))
      .$call(createQueryFilterExperiment(filter, 'experiment'))
      .select(['run.runId as runId', 'log.logNumber as logNumber'])
      .execute();
    return result.map((row) => ({
      runId: fromDbId(row.runId),
      logNumber: row.logNumber,
    }));
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
      .with('lastConfirmedLog', (db) =>
        db
          .selectFrom('runLogView as lv')
          .$call(createQueryFilterAll(filter, 'lv'))
          .leftJoin(
            // Grouping by sequence instead of run should
            // be fine because non canceled missing logs
            // should all be on the last sequence
            ({ selectFrom }) =>
              selectFrom('log as l')
                .where('l.logType', 'is', null)
                .where('canceledBy', 'is', null)
                .select((eb) => [
                  'sequenceId',
                  eb.fn.min('l.logNumber').as('logNumber'),
                ])
                .groupBy('sequenceId')
                .as('firstMissing'),
            (join) =>
              join.onRef('lv.sequenceId', '=', 'firstMissing.sequenceId'),
          )
          .where((eb) =>
            eb.and([
              eb('lv.logType', 'is not', null),
              eb.or([
                eb('firstMissing.logNumber', 'is', null),
                eb('lv.logNumber', '<', eb.ref('firstMissing.logNumber')),
              ]),
            ]),
          )
          .select((eb) => [
            'lv.logType',
            'lv.sequenceId',
            'lv.runId',
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
          .groupBy(['lv.runId', 'lv.logType']),
      )
      .selectFrom('log')
      .innerJoin('lastConfirmedLog as last', (join) =>
        join
          .onRef('log.sequenceId', '=', 'last.sequenceId')
          .onRef('log.logNumber', '=', 'last.lastNumber'),
      )
      .select((eb) => [
        'last.runId',
        'log.logId',
        'log.logType as type',
        'log.logNumber as number',
        eb
          .ref('log.logValues', '->')
          .key('$')
          .$castTo<string>()
          .as('jsonValues'),
      ])
      .$narrowType<{ type: string }>()
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

  async *getLogs(filter: AllFilter = {}): AsyncGenerator<Log> {
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
        .$call(createQueryFilterAll(filter, 'l'))
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
          values: parseJsonObject(logResult.values),
          experimentId: fromDbId(logResult.experimentId),
          runId: fromDbId(logResult.runId),
          logId: fromDbId(logResult.logId),
        };
      }
    }
  }

  async migrateDatabase(): Promise<void> {
    let migrator = new Migrator({
      db: this.#db,
      provider: new FileMigrationProvider({
        fs,
        path,
        migrationFolder: MIGRATION_FOLDER,
      }),
    });
    let result = await migrator.migrateToLatest();
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

  async close() {
    await this.#db.destroy();
  }
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
