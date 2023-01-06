import fs from 'node:fs/promises';
import path from 'node:path';
import * as url from 'node:url';
import SQliteDB from 'better-sqlite3';
import cuid from 'cuid';
import {
  Kysely,
  FileMigrationProvider,
  Generated,
  Migrator,
  SelectQueryBuilder,
  SqliteDialect,
  CamelCasePlugin,
} from 'kysely';
import { JsonObject } from 'type-fest';
import { arrayify } from './utils.js';
import loglevel, { LogLevelDesc } from 'loglevel';

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
type SessionTable = {
  id: string;
  createdAt: string;
  expiresAt: string | null;
  runId?: string;
  role: 'admin' | 'participant';
  cookie: string;
};

type Database = {
  run: RunTable;
  log: LogTable;
  logValue: LogValueTable;
  session: SessionTable;
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
      plugins: [new CamelCasePlugin()],
    });
  }

  async addRun({ id, experimentId }: { id?: string; experimentId?: string }) {
    let runId = id ?? cuid();
    await this.#db
      .insertInto('run')
      .values({
        id: runId,
        createdAt: new Date().toISOString(),
        experimentId,
        endedAt: null,
      })
      .execute();
    return runId;
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
    logs: Array<{
      type: string;
      runId: string;
      values: JsonObject;
    }>
  ) {
    await this.#db.transaction().execute(async (trx) => {
      let createdAt = new Date().toISOString();
      let dbLogs: Array<{
        id: bigint;
        type: string;
        runId: string;
        isAssigned?: boolean;
      }> = await trx
        .insertInto('log')
        .values(
          logs.map(({ type, runId }) => {
            return { type, runId, createdAt };
          })
        )
        .returning(['id as id', 'type as type', 'runId as runId'])
        .execute();

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
      .innerJoin('log', 'log.id', 'logValue.logId')
      .innerJoin('run', 'run.id', 'log.runId')
      .call(createLogQueryFilter(filter))
      .groupBy('logValue.name')
      .orderBy('logValue.name')
      .select(['logValue.name'])
      .execute();
    return result.map((it) => it.name);
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
    let request = this.#db
      .selectFrom('logValue')
      .innerJoin('log', 'log.id', 'logValue.logId')
      .innerJoin('run', 'run.id', 'log.runId')
      .call(createLogQueryFilter(filter))
      .orderBy('log.id')
      .select([
        'log.id as logId',
        'log.type as logType',
        'log.createdAt as logCreatedAt',
        'log.runId',
        'run.experimentId',
        'logValue.name',
        'logValue.value',
      ]);
    let result = await request.execute();

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

  async setSession({
    id,
    expiresAt,
    runId,
    cookie,
    role,
  }: {
    id?: string;
    expiresAt?: Date;
    runId?: string;
    role: 'admin' | 'participant';
    cookie: JsonObject;
  }) {
    // Use explicit column properties to avoid using extra properties in the
    // update set clause (e.g. createdAt could come back since it is
    // provided in getSession).
    let values = {
      id: id ?? cuid(),
      expiresAt: expiresAt?.toISOString() ?? undefined,
      runId,
      role,
      cookie: JSON.stringify(cookie),
    };
    await this.#db
      .insertInto('session')
      .values({ createdAt: new Date().toISOString(), ...values })
      .onConflict((conflict) => conflict.column('id').doUpdateSet(values))
      .execute();
  }

  async getSession(id: string) {
    let result = await this.#db
      .selectFrom('session')
      .where('session.id', '=', id)
      .leftJoin('run', 'run.id', 'session.runId')
      .select([
        'session.id as session.id',
        'session.createdAt as session.createdAt',
        'session.expiresAt as session.expiresAt',
        'session.cookie as session.cookie',
        'session.role as session.role',
        'run.id as run.id',
        'run.endedAt as run.endedAt',
        'run.createdAt as run.createdAt',
      ])
      .executeTakeFirst();
    if (!result) return;

    return {
      id: result['session.id'],
      createdAt: new Date(result['session.createdAt']),
      expiresAt: result['session.expiresAt']
        ? new Date(result['session.expiresAt'])
        : null,
      cookie: result['session.cookie']
        ? JSON.parse(result['session.cookie'])
        : null,
      role: result['session.role'],
      run:
        result['run.id'] != null
          ? {
              id: result['run.id'],
              endedAt: result['run.endedAt']
                ? new Date(result['run.endedAt'])
                : null,
              createdAt: result['run.createdAt']
                ? new Date(result['run.createdAt'])
                : null,
            }
          : null,
    };
  }

  async deleteSession(id: string) {
    return this.#db.deleteFrom('session').where('id', '=', id).execute();
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

const filterValues = ['type', 'runId', 'experimentId'] as const;
const filterColumns = {
  type: 'log.type',
  runId: 'log.runId',
  experimentId: 'run.experimentId',
} as const;
function createLogQueryFilter(filter: LogFilter = {}) {
  return (
    q: SelectQueryBuilder<Database, 'logValue' | 'log' | 'run', unknown>
  ) => {
    for (let filterValue of filterValues) {
      let targets = arrayify(filter[filterValue], true);
      if (targets.length > 0) {
        let col = filterColumns[filterValue];
        q = q.where((qb) => {
          for (let target of targets) {
            qb = qb.orWhere(col, '=', target);
          }
          return qb;
        });
      }
    }
    return q;
  };
}
