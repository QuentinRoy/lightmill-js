import SQLiteDB from 'better-sqlite3';
import {
  CamelCasePlugin,
  DeduplicateJoinsPlugin,
  FileMigrationProvider,
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
import { JsonObject, JsonValue } from 'type-fest';
import { StoreError } from './store-errors.js';
import {
  AllFilter,
  createQueryFilterAll,
  createQueryFilterExperiment,
  createQueryFilterRun,
  ExperimentFilter,
  LogFilter,
  RunFilter,
} from './store-filters.js';
import {
  Database,
  ExperimentId,
  fromDbId,
  Log,
  LogId,
  RunId,
  RunStatus,
  toDbId,
} from './store-types.js';
import { firstStrict } from './utils.js';
const __dirname = url.fileURLToPath(new URL('.', import.meta.url));

export {
  AllFilter,
  ExperimentFilter,
  ExperimentId,
  Log,
  LogFilter,
  LogId,
  RunFilter,
  RunId,
  StoreError,
};

const DEFAULT_SELECT_QUERY_LIMIT = 1_000_000;
const MIGRATION_FOLDER = path.join(__dirname, 'db-migrations');

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
            StoreError.EXPERIMENT_EXISTS,
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
              StoreError.RUN_EXISTS,
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
            StoreError.RUN_NOT_FOUND,
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
          StoreError.INVALID_LOG_NUMBER,
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

  async getRuns(
    // We currently rely on experimentName to decide whether to join the experiment table,
    // as it's the only ExperimentFilter property not in RunFilter. Using pick here (and below)
    // prevents subtle bugs where some filters might be applied only when experimentName is present.
    // If new properties are added to ExperimentFilter, this code will need updating.
    filter: RunFilter & Pick<ExperimentFilter, 'experimentName'> = {},
  ) {
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
        return new StoreError(
          `No run found for id ${runId}`,
          StoreError.RUN_NOT_FOUND,
        );
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
            StoreError.RUN_HAS_ENDED,
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
          () =>
            new StoreError(
              `No run found for id ${runId}`,
              StoreError.RUN_NOT_FOUND,
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
              StoreError.LOG_NUMBER_EXISTS_IN_SEQUENCE,
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

  async getLogValueNames(filter: AllFilter = {}) {
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
    Array<{ type: string; id: LogId; runId: RunId; values: JsonObject }>
  > {
    let result = await this.#db
      .with('noPendingLogs', (db) =>
        db
          .selectFrom('runLogView as lv')
          .$call(createQueryFilterAll(filter, 'lv'))
          .leftJoin(
            ({ selectFrom }) =>
              selectFrom('log')
                .where('logType', 'is', null)
                .select((eb) => [
                  eb.fn.min('logNumber').as('logNumber'),
                  'sequenceId',
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
      .innerJoin('noPendingLogs as npl', (join) =>
        join
          .onRef('log.sequenceId', '=', 'npl.sequenceId')
          .onRef('log.logNumber', '=', 'npl.lastNumber'),
      )
      .select((eb) => [
        'npl.runId',
        'log.logId as id',
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

    return result.map(({ jsonValues, runId, id, ...rest }) => {
      return {
        ...rest,
        runId: fromDbId(runId),
        id: fromDbId(id),
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

  async migrateDatabase() {
    let migrator = new Migrator({
      db: this.#db,
      provider: new FileMigrationProvider({
        fs,
        path,
        migrationFolder: MIGRATION_FOLDER,
      }),
    });
    return migrator.migrateToLatest();
  }

  async close() {
    await this.#db.destroy();
  }
}

function json<T>(value: T) {
  return sql<T>`jsonb(${JSON.stringify(value)})`;
}

function parseJsonObject(jsonString: string): JsonObject {
  let result: JsonValue = JSON.parse(jsonString);
  if (typeof result !== 'object' || result === null) {
    throw new Error('JSON is not an object');
  }
  if (result instanceof Array) {
    throw new Error('JSON is an array');
  }
  return result;
}
