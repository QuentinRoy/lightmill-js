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
    // Parsing is part of the async function, so a corrupt row reaches the
    // callback instead of leaving it uncalled.
    settle(
      (async () => {
        const row = await this.#db
          .selectFrom('lightmillSessions')
          .where('sid', '=', sid)
          .where('expiresAt', '>', Date.now())
          .select('data')
          .executeTakeFirst();
        return row === undefined ? null : (JSON.parse(row.data) as SessionData);
      })(),
      callback,
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
    settle(
      (async () => {
        await this.#db
          .deleteFrom('lightmillSessions')
          .where('expiresAt', '<=', now)
          .execute();
        await this.#db
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
          .execute();
      })(),
      callback,
    );
  }

  destroy(sid: string, callback?: (error?: unknown) => void): void {
    settle(
      this.#db.deleteFrom('lightmillSessions').where('sid', '=', sid).execute(),
      callback,
    );
  }
}

// Reports the outcome of `promise` the express-session way.
function settle<T>(
  promise: Promise<T>,
  callback: ((error: unknown, result?: T) => void) | undefined,
): void {
  promise.then(
    (result) => callback?.(null, result),
    (error: unknown) => callback?.(explainMissingTable(error)),
  );
}

function explainMissingTable(error: unknown): unknown {
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
