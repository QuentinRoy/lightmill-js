import SQLiteDB from 'better-sqlite3';
import session, { type SessionData } from 'express-session';
import type { Kysely } from 'kysely';
import type { Database } from './data-store.ts';

// Lifetime of a session whose cookie has no expiry (a browser-session cookie).
const FALLBACK_LIFETIME_MS = 24 * 60 * 60 * 1000;

/**
 * Persists sessions in the data store's database, through the data store's
 * connection: a session write waits for an open data store transaction rather
 * than racing it, and never joins it.
 */
export class SessionStore extends session.Store {
  #db: Kysely<Database>;

  constructor(db: Kysely<Database>) {
    super();
    this.#db = db;
  }

  get(
    sid: string,
    callback: (error: unknown, session?: SessionData | null) => void,
  ): void {
    this.#db
      .selectFrom('lightmillSessions')
      .where('sid', '=', sid)
      .where('expiresAt', '>', Date.now())
      .select('data')
      .executeTakeFirst()
      .then(
        (row) =>
          callback(null, row === undefined ? null : JSON.parse(row.data)),
        (error: unknown) => callback(rethrowMissingTable(error)),
      );
  }

  set(
    sid: string,
    data: SessionData,
    callback?: (error?: unknown) => void,
  ): void {
    const now = Date.now();
    const expiresAt =
      data.cookie.expires?.getTime() ?? now + FALLBACK_LIFETIME_MS;
    this.#db
      .deleteFrom('lightmillSessions')
      .where('expiresAt', '<=', now)
      .execute()
      .then(() =>
        this.#db
          .insertInto('lightmillSessions')
          .values({ sid, data: JSON.stringify(data), expiresAt })
          .onConflict((conflict) =>
            conflict
              .column('sid')
              .doUpdateSet((eb) => ({
                data: eb.ref('excluded.data'),
                expiresAt: eb.ref('excluded.expiresAt'),
              })),
          )
          .execute(),
      )
      .then(
        () => callback?.(),
        (error: unknown) => callback?.(rethrowMissingTable(error)),
      );
  }

  destroy(sid: string, callback?: (error?: unknown) => void): void {
    this.#db
      .deleteFrom('lightmillSessions')
      .where('sid', '=', sid)
      .execute()
      .then(
        () => callback?.(),
        (error: unknown) => callback?.(rethrowMissingTable(error)),
      );
  }
}

function rethrowMissingTable(error: unknown): unknown {
  if (
    error instanceof SQLiteDB.SqliteError &&
    error.message.includes('no such table: lightmill_sessions')
  ) {
    return new Error(
      'The session table does not exist. Run migrateDatabase() (or "log-server migrate") first.',
      { cause: error },
    );
  }
  return error;
}
