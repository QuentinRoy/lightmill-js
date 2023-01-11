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

const __dirname = url.fileURLToPath(new URL('.', import.meta.url));
const migrationFolder = path.join(__dirname, 'db-migrations');

type RunTable = {
  id: string;
  experimentId: string | null;
  createdAt: string;
  endedAt: string | null;
};
type LogTable = {
  id: Generated<bigint>;
  type: string;
  runId: string;
  createdAt: string;
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
    id,
    createdAt,
    experimentId,
  }: {
    id: string;
    createdAt: Date;
    experimentId?: string;
  }) {
    await this.#db
      .insertInto('run')
      .values({
        id,
        createdAt: createdAt.toISOString(),
        experimentId,
        endedAt: null,
      })
      .execute();
  }

  async getRun(id: string) {
    let selection = await this.#db
      .selectFrom('run')
      .where('id', '=', id)
      .selectAll()
      .executeTakeFirst();
    if (!selection) return;
    return {
      ...selection,
      createdAt:
        selection.createdAt != null ? new Date(selection.createdAt) : null,
      endedAt: selection.endedAt != null ? new Date(selection.endedAt) : null,
    };
  }

  async endRun(id: string) {
    await this.#db
      .updateTable('run')
      .set({ endedAt: new Date().toISOString() })
      .where('id', '=', id)
      .execute();
  }

  // This methods is O(n^2) in the number of logs to insert, but n is expected
  // to be relatively small.
  async addLogs(
    logs: Array<{ type: string; runId: string; values: JsonObject }>
  ) {
    await this.#db.transaction().execute(async (trx) => {
      let createdAt = new Date().toISOString();
      let dbLogs = await trx
        .insertInto('log')
        .values(
          logs.map(({ type, runId }) => {
            return { type, runId, createdAt };
          })
        )
        .returning(['id', 'type', 'runId'])
        .execute()
        .then((selection) =>
          selection.map((it) => ({ ...it, isAssigned: false }))
        );

      // Bulk insert returning values does not guarantee order, so we need to
      // match the log values logs to returned log ids.
      let dbValues = [];
      for (let log of logs) {
        let dbLog = dbLogs.find(
          (it) =>
            it.type === log.type && it.runId === log.runId && !it.isAssigned
        );
        if (!dbLog) {
          throw new Error(
            `failed to find an unassigned inserted log with type "${log.type}" and runId "${log.runId}"`
          );
        }
        dbLog.isAssigned = true;
        dbValues.push(...deconstructValues(log.values, { logId: dbLog.id }));
      }
      await trx.insertInto('logValue').values(dbValues).execute();
    });
  }

  async getLogValueNames(filter: LogFilter = {}) {
    let result = await this.#db
      .selectFrom('logValue')
      .if(filter.type != null, (qb) =>
        qb.innerJoin('log', 'log.id', 'logValue.logId').where((qb) => {
          let types = arrayify(filter.type, true);
          for (let type of types) {
            qb = qb.orWhere('log.type', '=', type);
          }
          return qb;
        })
      )
      .if(filter.runId != null, (qb) =>
        qb.innerJoin('log', 'log.id', 'logValue.logId').where((qb) => {
          let runIds = arrayify(filter.runId, true);
          for (let runId of runIds) {
            qb = qb.orWhere('log.runId', '=', runId);
          }
          return qb;
        })
      )
      .if(filter.experimentId != null, (qb) =>
        qb
          .innerJoin('log', 'log.id', 'logValue.logId')
          .innerJoin('run', 'run.id', 'log.runId')
          .where((qb) => {
            let experimentIds = arrayify(filter.experimentId, true);
            for (let experimentId of experimentIds) {
              qb = qb.orWhere('run.experimentId', '=', experimentId);
            }
            return qb;
          })
      )
      .select('logValue.name as logValueName')
      .orderBy('logValueName')
      .distinct()
      .execute();
    return result.map((it) => it.logValueName);
  }

  async hasNonEmptyExperimentId() {
    let result = await this.#db
      .selectFrom('run')
      .where('experimentId', 'is not', null)
      .select('experimentId')
      .executeTakeFirst();
    return result != null;
  }

  async *getLogs(filter: LogFilter = {}) {
    let result = await this.#db
      .selectFrom('logValue')
      .innerJoin('log', 'log.id', 'logValue.logId')
      .innerJoin('run', 'run.id', 'log.runId')
      .if(filter.type != null, (qb) =>
        qb.where((qb) => {
          let types = arrayify(filter.type, true);
          for (let type of types) {
            qb = qb.orWhere('log.type', '=', type);
          }
          return qb;
        })
      )
      .if(filter.runId != null, (qb) =>
        qb.where((qb) => {
          let runIds = arrayify(filter.runId, true);
          for (let runId of runIds) {
            qb = qb.orWhere('log.runId', '=', runId);
          }
          return qb;
        })
      )
      .if(filter.experimentId != null, (qb) =>
        qb.where((qb) => {
          let experimentIds = arrayify(filter.experimentId, true);
          for (let experimentId of experimentIds) {
            qb = qb.orWhere('run.experimentId', '=', experimentId);
          }
          return qb;
        })
      )
      .orderBy('logValue.logId')
      .select([
        'log.id as logId',
        'log.type as logType',
        'log.createdAt as logCreatedAt',
        'log.runId',
        'run.experimentId',
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
          type: row.logType,
          experimentId: row.experimentId ?? undefined,
          runId: row.runId,
          createdAt: new Date(row.logCreatedAt),
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

type LogFilter = {
  type?: string | string[];
  runId?: string | string[];
  experimentId?: string | string[];
};
