import fs from 'node:fs/promises';
import path from 'node:path';
import * as url from 'node:url';
import SQliteDB from 'better-sqlite3';
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
import { arrayify } from './utils.js';
import { pipe, sortBy } from 'remeda';

const __dirname = url.fileURLToPath(new URL('.', import.meta.url));
const migrationFolder = path.join(__dirname, 'db-migrations');

type RunTable = {
  runId: string;
  experimentId: string;
  createdAt: string;
  status: 'running' | 'completed' | 'canceled';
};
type LogTable = {
  logId: Generated<bigint>;
  experimentId: string;
  runId: string;
  type: string;
  createdAt: string;
  clientDate?: string;
  // batchOrder records the order in which the logs were sent by the client
  // in a single request. This is used to sort logs with the same clientDate.
  batchOrder?: number;
};
type LogValueTable = {
  logId: bigint;
  name: string;
  value: string;
};

type Database = {
  run: RunTable;
  log: LogTable;
  logValue: LogValueTable;
};

export class Store {
  #db: Kysely<Database>;
  constructor(
    db: string,
    { logLevel = loglevel.getLevel() }: { logLevel?: LogLevelDesc } = {}
  ) {
    const log = loglevel.getLogger('store');
    log.setLevel(logLevel);
    this.#db = new Kysely({
      dialect: new SqliteDialect({ database: new SQliteDB(db) }),
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
    createdAt,
  }: {
    runId: string;
    experimentId: string;
    createdAt: Date;
  }) {
    let result = await this.#db
      .insertInto('run')
      .values({
        runId,
        experimentId,
        createdAt: createdAt.toISOString(),
        status: 'running',
      })
      .returning(['runId', 'experimentId'])
      .executeTakeFirstOrThrow();
    return { runId: result.runId, experimentId: result.experimentId };
  }

  async getRun(experimentId: string, runId: string) {
    let selection = await this.#db
      .selectFrom('run')
      .where('experimentId', '=', experimentId)
      .where('runId', '=', runId)
      .selectAll()
      .executeTakeFirst();
    if (!selection) return;
    return {
      ...selection,
      createdAt:
        selection.createdAt != null ? new Date(selection.createdAt) : null,
    };
  }

  async setRunStatus(
    experimentId: string,
    runId: string,
    status: RunTable['status']
  ) {
    await this.#db
      .updateTable('run')
      .where('experimentId', '=', experimentId)
      .where('runId', '=', runId)
      .set({ status })
      .execute();
  }

  async addRunLogs(
    experimentId: string,
    runId: string,
    logs: Array<{
      type: string;
      date: Date;
      values: JsonObject;
    }>
  ) {
    await this.#db.transaction().execute(async (trx) => {
      let createdAt = new Date().toISOString();
      let dbLogs = pipe(
        await trx
          .insertInto('log')
          .values(
            logs.map(({ type, date }, i) => {
              return {
                type,
                runId,
                experimentId,
                createdAt,
                clientDate: date.toISOString(),
                batchOrder: i,
              };
            })
          )
          .returning(['logId', 'batchOrder'])
          .execute(),
        sortBy((log) => log.batchOrder ?? 0)
      );

      // Bulk insert returning values does not guarantee order, so we need to
      // match the log values logs to returned log ids.
      let dbValues = [];
      for (let log of logs) {
        let dbLog = dbLogs.shift();
        if (dbLog == null) {
          throw new Error(`could not insert log values: log was not inserted`);
        }
        dbValues.push(...deconstructValues(log.values, { logId: dbLog.logId }));
      }
      await trx.insertInto('logValue').values(dbValues).execute();
    });
  }

  async getLogValueNames(filter: LogFilter = {}) {
    let result = await this.#db
      .selectFrom('logValue')
      .$if(filter.experiment != null, (qb) =>
        qb
          .innerJoin('log', 'log.logId', 'logValue.logId')
          .where('log.experimentId', 'in', arrayify(filter.experiment, true))
      )
      .$if(filter.run != null, (qb) =>
        qb
          .innerJoin('log', 'log.logId', 'logValue.logId')
          .where('log.runId', 'in', arrayify(filter.run, true))
      )
      .$if(filter.type != null, (qb) =>
        qb
          .innerJoin('log', 'log.logId', 'logValue.logId')
          .where('log.type', 'in', arrayify(filter.type, true))
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
      .innerJoin('log', 'log.logId', 'logValue.logId')
      .$if(filter.experiment != null, (qb) =>
        qb.where('log.experimentId', 'in', arrayify(filter.experiment, true))
      )
      .$if(filter.run != null, (qb) =>
        qb.where('log.runId', 'in', arrayify(filter.run, true))
      )
      .$if(filter.type != null, (qb) =>
        qb.where('log.type', 'in', arrayify(filter.type, true))
      )
      .orderBy('log.experimentId')
      .orderBy('log.runId')
      .orderBy('log.type')
      .orderBy('log.clientDate')
      .orderBy('log.createdAt')
      .orderBy('log.batchOrder')
      .select([
        'log.experimentId as experimentId',
        'log.runId as runId',
        'log.logId as logId',
        'log.type as logType',
        'log.clientDate as logClientDate',
        'log.createdAt as logCreatedAt',
        'logValue.name',
        'logValue.value',
      ])
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
          createdAt: new Date(row.logCreatedAt),
          clientDate: row.logClientDate
            ? new Date(row.logClientDate)
            : undefined,
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
  data: JsonObject
): Array<{ name: string; value: string }>;
function deconstructValues<P extends Record<string, unknown>>(
  data: JsonObject,
  patch: P
): Array<P & { name: string; value: string }>;
function deconstructValues(
  data: JsonObject,
  patch?: Record<string, unknown>
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
  type: string;
  createdAt: Date;
  clientDate?: Date;
  values: JsonObject;
};
