import SQLiteDB from 'better-sqlite3';
import session, { type SessionData } from 'express-session';

/**
 * Persistent session store used by the standalone server.
 */
export class SQLiteSessionStore extends session.Store {
  #db: SQLiteDB.Database;

  constructor(dbPath: string) {
    super();
    this.#db = new SQLiteDB(dbPath);
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS lightmill_sessions (
        sid TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS lightmill_sessions_expires_at
        ON lightmill_sessions(expires_at);
    `);
  }

  get(
    sid: string,
    callback: (error: unknown, session?: SessionData | null) => void,
  ): void {
    try {
      const row = this.#db
        .prepare(
          'SELECT data FROM lightmill_sessions WHERE sid = ? AND expires_at > ?',
        )
        .get(sid, Date.now()) as { data: string } | undefined;
      callback(null, row === undefined ? null : JSON.parse(row.data));
    } catch (error) {
      callback(error);
    }
  }

  set(
    sid: string,
    data: SessionData,
    callback?: (error?: unknown) => void,
  ): void {
    try {
      this.#db
        .prepare('DELETE FROM lightmill_sessions WHERE expires_at <= ?')
        .run(Date.now());
      const expiresAt = data.cookie.expires?.getTime();
      if (expiresAt == null) {
        throw new Error('Persistent sessions require a cookie expiration');
      }
      this.#db
        .prepare(
          `INSERT INTO lightmill_sessions (sid, data, expires_at)
           VALUES (?, ?, ?)
           ON CONFLICT(sid) DO UPDATE SET
             data = excluded.data, expires_at = excluded.expires_at`,
        )
        .run(sid, JSON.stringify(data), expiresAt);
      callback?.();
    } catch (error) {
      callback?.(error);
    }
  }

  destroy(sid: string, callback?: (error?: unknown) => void): void {
    try {
      this.#db.prepare('DELETE FROM lightmill_sessions WHERE sid = ?').run(sid);
      callback?.();
    } catch (error) {
      callback?.(error);
    }
  }

  close(): void {
    this.#db.close();
  }
}
