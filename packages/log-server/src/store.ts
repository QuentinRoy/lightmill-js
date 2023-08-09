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
} from 'kysely';
import { JsonObject } from 'type-fest';
import loglevel, { LogLevelDesc } from 'loglevel';
import { sortBy } from 'remeda';
import { arrayify } from './utils.js';

const __dirname = url.fileURLToPath(new URL('.', import.meta.url));
const migrationFolder = path.join(__dirname, 'db-migrations');

export type Store = Omit<SQLiteStore, 'migrateDatabase' | 'close'>;

type RunTable = {
  runDbId: Generated<bigint>;
  runId: string;
  experimentId: string;
  status: 'running' | 'completed' | 'canceled';
  createdAt: string;
};
type LogTable = {
  logDbId: Generated<bigint>;
  runDbId: bigint;
  number: number;
  type: string;
  createdAt: string;
};
type LogValueTable = {
  logDbId: bigint;
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
    await this.#db.transaction().execute(async (trx) => {
      let runQuery = await trx
        .selectFrom('run')
        .where('experimentId', '=', experimentId)
        .where('runId', '=', runId)
        .select('runDbId')
        .executeTakeFirst();
      if (runQuery == null) {
        throw new Error(
          `run "${runId}" of experiment "${experimentId}" not found`,
        );
      }
      let { runDbId } = runQuery;
      let sortedLogs = sortBy(logs, (log) => log.number);
      let createdAt = new Date().toISOString();
      let dbLogs = await trx
        .insertInto('log')
        .values(
          sortedLogs.map(({ type, number }) => {
            return { type, number, runDbId, createdAt };
          }),
        )
        .returning(['logDbId', 'number'])
        .execute();

      // Sort by number to ensure that the log values are properly
      // associated with the logs because that cannot be done in an insert
      // query, and the order of the returning values is not guaranteed.
      let logValues = sortBy(dbLogs, (dbLog) => dbLog.number).flatMap(
        (dbLog, i) => {
          let logDbId = dbLog.logDbId;
          let values = sortedLogs[i].values;
          return deconstructValues(values, { logDbId });
        },
      );
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

  async *getLogs(filter: LogFilter = {}): AsyncGenerator<Log> {
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
      .select([
        'run.experimentId as experimentId',
        'run.runId as runId',
        'log.logDbId as logId',
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
      if (currentLog == null || row.logId !== currentLogId) {
        if (currentLog != null) {
          yield currentLog;
        }
        currentLog = {
          experimentId: row.experimentId,
          runId: row.runId,
          type: row.logType,
          number: row.logNumber,
          values: {} as JsonObject,
        };
        currentLogId = row.logId;
      }
      currentLog.values[row.name] = JSON.parse(row.value);
    }
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
