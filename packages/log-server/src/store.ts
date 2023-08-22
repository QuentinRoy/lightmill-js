import fs from 'node:fs/promises';
import path from 'node:path';
import * as url from 'node:url';
import SQLiteDB, { SqliteError } from 'better-sqlite3';
import {
  Kysely,
  FileMigrationProvider,
  Generated,
  Migrator,
  SqliteDialect,
  CamelCasePlugin,
  DeduplicateJoinsPlugin,
  InsertObject,
} from 'kysely';
import { JsonObject } from 'type-fest';
import loglevel, { LogLevelDesc } from 'loglevel';
import { groupBy, maxBy, minBy } from 'remeda';
import { arrayify } from './utils.js';

const __dirname = url.fileURLToPath(new URL('.', import.meta.url));
const migrationFolder = path.join(__dirname, 'db-migrations');

export type Store = Omit<SQLiteStore, 'migrateDatabase' | 'close'>;

type RunTable = {
  runDbId: Generated<number>;
  runId: string;
  experimentId: string;
  status: 'running' | 'completed' | 'canceled';
  createdAt?: string;
};
type LogTable = {
  logDbId: Generated<number>;
  runDbId: number;
  number: number;
  createdAt?: string;
  // Logs with no type are used to fill in missing log numbers.
  type?: string;
};

type LogValueTable = {
  logDbId: number;
  name: string;
  value: string;
};

type Database = {
  run: RunTable;
  log: LogTable;
  logValue: LogValueTable;
};

export class SQLiteStore {
  #db: Kysely<Database>;
  constructor(
    db: string,
    { logLevel = loglevel.getLevel() }: { logLevel?: LogLevelDesc } = {},
  ) {
    const log = loglevel.getLogger('store');
    log.setLevel(logLevel);
    this.#db = new Kysely({
      dialect: new SqliteDialect({ database: new SQLiteDB(db) }),
      log: (event) => {
        if (event.level === 'query') {
          log.debug(event.query.sql, event.query.parameters);
        } else if (event.level === 'error') {
          log.error(event.error);
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
    try {
      let result = await this.#db
        .insertInto('run')
        .values({
          runId,
          experimentId,
          status: 'running',
          createdAt: new Date().toISOString(),
        })
        .returning(['runId', 'experimentId'])
        .executeTakeFirstOrThrow();
      return { runId: result.runId, experimentId: result.experimentId };
    } catch (e) {
      if (
        e instanceof SqliteError &&
        e.code === 'SQLITE_CONSTRAINT_PRIMARYKEY'
      ) {
        throw new StoreError(
          `run "${runId}" already exists for experiment "${experimentId}".`,
          'RUN_EXISTS',
        );
      }
      throw e;
    }
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
    status: RunTable['status'],
  ) {
    await this.#db
      .updateTable('run')
      .where('experimentId', '=', experimentId)
      .where('runId', '=', runId)
      .set({ status })
      .execute();
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
      let infoQuery = await trx
        .selectFrom('run')
        .where('experimentId', '=', experimentId)
        .where('runId', '=', runId)
        .leftJoin('log', 'log.runDbId', 'run.runDbId')
        .groupBy('run.runDbId')
        .select(({ fn }) => [
          'run.runDbId as runDbId',
          fn.max('log.number').as('currentLogNumber'),
        ])
        .executeTakeFirst();
      if (infoQuery?.runDbId == null) {
        throw new Error(
          `run "${runId}" of experiment "${experimentId}" not found`,
        );
      }
      let indexedNewLogs = groupBy(logs, (log) => log.number);
      let { runDbId } = infoQuery;
      let currentLogNumber = infoQuery.currentLogNumber ?? 0;
      let futureLogNumber = maxBy(logs, (log) => log.number)?.number ?? 0;
      let firstNewLogNumber = minBy(logs, (log) => log.number)?.number ?? 0;
      let createdAt = new Date().toISOString();

      // Start by updating existing logs.
      let logRows = new Array<InsertObject<Database, 'log'>>();
      // Add new logs and fill in missing logs.
      for (let nb = firstNewLogNumber; nb <= futureLogNumber; nb++) {
        let logs = indexedNewLogs[nb] ?? [];
        if (logs.length > 0) {
          // It is forbidden for two logs to have the same number, but if that
          // happens, the database should be the one to complain.
          logRows.push(
            ...logs.map(({ type, number }) => ({
              runDbId,
              type,
              number,
              createdAt,
            })),
          );
        } else if (nb > currentLogNumber) {
          // If the log number is greater than the current log number, then
          // there is a missing log. We need to add it to the database.
          logRows.push({ runDbId, number: nb });
        }
        // Otherwise do nothing because the log (or missing log) should already
        // be in the database.
      }
      let dbLogs = await trx
        .insertInto('log')
        .values(logRows)
        .onConflict((oc) =>
          // This update is safe because it should fail if the log type is not
          // null, which would mean that the log already exists.
          oc.columns(['runDbId', 'number']).doUpdateSet((eb) => ({
            type: eb.ref('excluded.type'),
            createdAt: eb.ref('excluded.createdAt'),
          })),
        )
        .returning(['logDbId', 'number', 'type'])
        .execute();

      // Sort by number to ensure that the log values are properly
      // associated with the logs because that cannot be done in an insert
      // query, and the order of the returning values is not guaranteed.
      let logValues = dbLogs
        .filter((l) => l.type != null)
        .flatMap((dbLog) => {
          // We know there is only one log with this number because of the
          // loop above.
          let values = indexedNewLogs[dbLog.number][0].values;
          return deconstructValues(values, { logDbId: dbLog.logDbId });
        });
      if (logValues.length > 0) {
        await trx.insertInto('logValue').values(logValues).execute();
      }
    });
  }

  async getLogValueNames(filter: LogFilter = {}) {
    let result = await this.#db
      .selectFrom('logValue')
      .$if(filter.experiment != null, (qb) =>
        qb
          .innerJoin('log', 'log.logDbId', 'logValue.logDbId')
          .innerJoin('run', 'run.runDbId', 'log.runDbId')
          .where('run.experimentId', 'in', arrayify(filter.experiment, true)),
      )
      .$if(filter.run != null, (qb) =>
        qb
          .innerJoin('log', 'log.logDbId', 'logValue.logDbId')
          .innerJoin('run', 'run.runDbId', 'log.runDbId')
          .where('run.runId', 'in', arrayify(filter.run, true)),
      )
      .$if(filter.type != null, (qb) =>
        qb
          .innerJoin('log', 'log.logDbId', 'logValue.logDbId')
          .where('log.type', 'in', arrayify(filter.type, true)),
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
    filter: Omit<LogFilter, 'experiment' | 'run'> & {
      experiment: string;
      run: string;
    },
  ): Promise<
    Array<{ type: string; count: number; pending: number; lastNumber: number }>
  > {
    let result = await this.#db
      .selectFrom('log')
      .innerJoin('run', 'run.runDbId', 'log.runDbId')
      .where('run.experimentId', '=', filter.experiment)
      .where('run.runId', '=', filter.run)
      .$if(filter.type != null, (qb) =>
        qb.where('log.type', 'in', arrayify(filter.type, true)),
      )
      .where('log.type', 'is not', null)
      .leftJoin(
        (eb) =>
          eb
            .selectFrom('log')
            .where('type', 'is', null)
            .select((eb) => ['runDbId', eb.fn.min('number').as('first')])
            .groupBy('runDbId')
            .as('missing'),
        (join) => join.onRef('log.runDbId', '=', 'missing.runDbId'),
      )
      .select((eb) => [
        'log.type',
        eb.fn
          .countAll()
          .filterWhere(
            eb.or([
              eb('missing.first', 'is', null),
              eb('log.number', '<', eb.ref('missing.first')),
            ]),
          )
          .as('count'),
        // In theory any logs from a run with no missing logs should not
        // be counted because missing.first will be null so the filter will
        // be unknown, so the log will not be included.
        eb.fn
          .countAll()
          .filterWhere('log.number', '>', eb.ref('missing.first'))
          .as('pending'),
        eb.fn
          .max('log.number')
          .filterWhere(
            eb.or([
              eb('missing.first', 'is', null),
              eb('log.number', '<', eb.ref('missing.first')),
            ]),
          )
          .as('lastNumber'),
      ])
      .groupBy('log.type')
      .orderBy('log.type')
      .execute();
    return result.map(({ pending, count, lastNumber, type }) => {
      if (type == null) {
        throw new Error('SQL query returned a row with no type');
      }
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
    // this could be a lot of data. However until this becomes a problem, this
    // is good enough.
    let result = await this.#db
      .selectFrom('logValue')
      .innerJoin('log', 'log.logDbId', 'logValue.logDbId')
      .innerJoin('run', 'run.runDbId', 'log.runDbId')
      .$if(filter.experiment != null, (qb) =>
        qb.where('run.experimentId', 'in', arrayify(filter.experiment, true)),
      )
      .$if(filter.run != null, (qb) =>
        qb.where('run.runId', 'in', arrayify(filter.run, true)),
      )
      .$if(filter.type != null, (qb) =>
        qb.where('log.type', 'in', arrayify(filter.type, true)),
      )
      .where('log.type', 'is not', null)
      .select([
        'run.experimentId as experimentId',
        'run.runId as runId',
        'log.logDbId as logDbId',
        'log.type as logType',
        'log.number as logNumber',
        'logValue.name',
        'logValue.value',
      ])
      .orderBy('experimentId')
      .orderBy('runId')
      .orderBy('logNumber')
      .execute();

    let currentLog = null;
    let currentLogId = null;
    for (let row of result) {
      if (currentLog == null || row.logDbId !== currentLogId) {
        if (currentLog != null) {
          yield currentLog;
        }
        if (row.logType == null) {
          throw new Error('SQL query returned a log with no type');
        }
        currentLog = {
          experimentId: row.experimentId,
          runId: row.runId,
          type: row.logType,
          number: row.logNumber,
          values: {} as JsonObject,
        };
        currentLogId = row.logDbId;
      }
      currentLog.values[row.name] = JSON.parse(row.value);
    }
    // Let us not forget the last one!
    if (currentLog != null) {
      yield currentLog;
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

export type LogFilter = {
  type?: string | string[];
  run?: string | string[];
  experiment?: string | string[];
};

export type Log = {
  experimentId: string;
  runId: string;
  number: number;
  type: string;
  values: JsonObject;
};

type StoreErrorCode = 'RUN_EXISTS';
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
