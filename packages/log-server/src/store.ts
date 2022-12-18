import fs from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import cuid from 'cuid';
import * as url from 'url';

const __dirname = url.fileURLToPath(new URL('.', import.meta.url));

import { FileMigrationProvider, Kysely, Migrator, SqliteDialect } from 'kysely';
import { JsonObject } from 'type-fest';

type RunTable = {
  id: string;
  experimentId: string | null;
  createdAt: string;
  endedAt: string | null;
};
type LogTable = {
  id: string;
  type: string;
  runId: string;
  createdAt: string;
};
type LogValueTable = {
  logId: string;
  name: string;
  value: string;
};
type SessionTable = {
  id: string;
  createdAt: string;
  expiresAt: string | null;
  runId: string;
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

  constructor(db: Kysely<Database> | string) {
    if (typeof db === 'string') {
      this.#db = new Kysely({
        dialect: new SqliteDialect({ database: new Database(db) }),
      });
    } else {
      this.#db = db;
    }
  }

  async addRun({ id, experimentId }: { id?: string; experimentId?: string }) {
    return this.#db.transaction().execute(async (trx) => {
      let runId = id ?? cuid();
      await trx
        .insertInto('run')
        .values({
          id: runId,
          createdAt: new Date().toISOString(),
          experimentId,
          endedAt: null,
        })
        .execute();
      return runId;
    });
  }

  async addLogs(
    logs: Array<{
      type: string;
      runId: string;
      values: JsonObject;
    }>
  ) {
    await this.#db.transaction().execute(async (trx) => {
      let createdAt = new Date().toISOString();
      let dbLogs = logs.map((log) => {
        let id = cuid();
        let values = deconstructValues(log.values, { logId: id });
        return { ...log, id, values };
      });
      await trx
        .insertInto('log')
        .values(
          dbLogs.map(({ type, runId, id }) => {
            return { id, type, runId, createdAt };
          })
        )
        .execute();
      await trx
        .insertInto('logValue')
        .values(dbLogs.flatMap((log) => log.values))
        .execute();
    });
  }

  async setSession({
    id,
    expiresAt,
    runId,
    cookie,
  }: {
    id?: string;
    expiresAt?: Date;
    runId: string;
    cookie: JsonObject;
  }) {
    // Use explicit column properties to avoid using extra properties in the
    // update set clause (e.g. createdAt could come back since it is
    // provided in getSession).
    let values = {
      id: id ?? cuid(),
      expiresAt: expiresAt?.toISOString() ?? undefined,
      runId,
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
      .innerJoin('run', 'run.id', 'session.runId')
      .select([
        'session.id as session.id',
        'session.createdAt as session.createdAt',
        'session.expiresAt as session.expiresAt',
        'session.cookie as session.cookie',
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
      run: {
        id: result['run.id'],
        endedAt: result['run.endedAt'] ? new Date(result['run.endedAt']) : null,
        createdAt: new Date(result['run.createdAt']),
      },
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
        migrationFolder: path.join(__dirname, 'db-migrations'),
      }),
    });
    return migrator.migrateToLatest();
  }
}

function deconstructValues(
  data: JsonObject
): Array<{ name: string; value: string }>;
function deconstructValues<E extends Record<string, unknown>>(
  data: JsonObject,
  extensions: E
): Array<E & { name: string; value: string }>;
function deconstructValues(
  data: JsonObject,
  extensions?: Record<string, unknown>
): Array<JsonObject & { name: string; value: string }> {
  return Object.entries(data).map(([name, value]) => ({
    ...extensions,
    name,
    value: JSON.stringify(value),
  }));
}

function reconstructValues(values: { name: string; value: string }[]) {
  let data: JsonObject = {};
  for (let value of values) {
    data[value.name] = JSON.parse(value.value);
  }
  return data;
}
