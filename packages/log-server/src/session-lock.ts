import type { Request } from 'express';
import type { Session, SessionData, Store } from 'express-session';
import { promisify } from 'node:util';

export interface LockedSession {
  /** The session as the store holds it, read once the lock was taken. */
  sessionData: SessionData['data'];
  /** Writes the session before it resolves, so the next holder reads it. */
  save(sessionData: SessionData['data']): Promise<void>;
  destroy(): Promise<void>;
}

/**
 * Orders the requests that change a session, one session at a time: `fn` runs
 * when no other request holds the session's lock, and holds it until it
 * settles, even if its client is gone. A session that no longer exists makes
 * it throw `SessionGoneError` without running `fn`.
 *
 * Do not call `save` or `destroy` from inside a data store transaction: the
 * SQLite session store shares the data connection, so it would wait for a
 * transaction that is waiting for it.
 */
export type LockSession = <Response>(
  fn: (session: LockedSession) => Promise<Response>,
) => Promise<Response>;

// What the lock uses of a request, so a test does not have to build a whole one.
type LockableRequest = Pick<Request, 'sessionID'> & {
  sessionStore: Pick<Store, 'get' | 'set'>;
  session: {
    cookie: Session['cookie'];
    touch(): unknown;
    destroy(callback: (error?: unknown) => void): unknown;
  };
};

/** The session of a request that asked for its lock no longer exists. */
export class SessionGoneError extends Error {}

// For each session that a request holds the lock of or waits for, a promise
// that settles when the last of those requests is done. A session nobody holds
// or waits for has no entry.
const sessionLocks = new Map<string, Promise<void>>();

/**
 * Runs `fn` with the lock of the request's session. The session is read once
 * the lock is held: express-session loaded it before any handler ran, so what
 * the request carries may be out of date by then.
 *
 * Nothing times out: letting go of the lock while its holder is still running
 * would let that holder save after the next one read.
 */
export async function lockSession<Response>(
  request: LockableRequest,
  fn: (session: LockedSession) => Promise<Response>,
): Promise<Response> {
  const { sessionID, sessionStore: store } = request;
  const previous = sessionLocks.get(sessionID);
  const turn = (async () => {
    await previous;
    const stored = await promisify(store.get.bind(store))(sessionID);
    if (stored?.data == null) throw new SessionGoneError();
    return fn({
      sessionData: stored.data,
      save(sessionData) {
        // The request's own session object is left alone on purpose:
        // express-session saves it when the response ends, after the lock is
        // released, if it looks modified. Touching it moves the expiry, as
        // express-session does before it saves.
        request.session.touch();
        return promisify(store.set.bind(store))(sessionID, {
          ...stored,
          cookie: request.session.cookie,
          data: sessionData,
        });
      },
      destroy: () => promisify(request.session.destroy.bind(request.session))(),
    });
  })();
  const tail = turn.then(
    () => {},
    () => {},
  );
  sessionLocks.set(sessionID, tail);
  try {
    return await turn;
  } finally {
    if (sessionLocks.get(sessionID) === tail) sessionLocks.delete(sessionID);
  }
}
