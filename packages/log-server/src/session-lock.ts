import type { Request } from 'express';
import type { SessionData } from 'express-session';
import { finished } from 'node:stream';
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
 * when no other request holds the session's lock, and the lock is held until
 * `fn` settles and the response has finished, even if its client is gone. A
 * session that no longer exists makes it throw `SessionGoneError` without
 * running `fn`.
 *
 * Do not call `save` or `destroy` from inside a data store transaction: the
 * SQLite session store shares the data connection, so it would wait for a
 * transaction that is waiting for it.
 */
export type LockSession = <Response>(
  fn: (session: LockedSession) => Promise<Response>,
) => Promise<Response>;

// What the lock uses of a request, so a test does not have to build a whole one.
type LockableRequest = Pick<Request, 'sessionID' | 'session'>;

/** The session of a request that asked for its lock no longer exists. */
export class SessionGoneError extends Error {}

// For each session that a request holds the lock of or waits for, a promise
// that settles when the last of those requests is done. A session nobody holds
// or waits for has no entry.
const sessionLocks = new Map<string, Promise<void>>();

/**
 * Runs `fn` with the lock of the request's session, through express-session's
 * own `reload`, `save`, and `destroy`.
 *
 * The lock is released once `responseFinished` settles too: express-session
 * touches or saves the session when the response ends, and that write must
 * land before the next holder reads. Nothing times out: letting go of the lock
 * while its holder is still running would let that holder save after the next
 * one read.
 */
export function lockSession<Response>(
  request: LockableRequest,
  responseFinished: Promise<unknown>,
  fn: (session: LockedSession) => Promise<Response>,
): Promise<Response> {
  const { sessionID } = request;
  const previous = sessionLocks.get(sessionID);
  const turn = (async () => {
    await previous;
    const { session, sessionData } = await reload(request);
    let saved = sessionData;
    return fn({
      sessionData,
      async save(newSessionData) {
        session.data = newSessionData;
        // Moves the expiry, as express-session does before it saves.
        session.touch();
        try {
          await promisify(session.save.bind(session))();
          saved = newSessionData;
        } catch (error) {
          // express-session writes the session again when the response ends,
          // and must not write what this request failed to save.
          session.data = saved;
          throw error;
        }
      },
      destroy: () => promisify(session.destroy.bind(session))(),
    });
  })();
  const tail = Promise.allSettled([turn, responseFinished]).then(() => {});
  sessionLocks.set(sessionID, tail);
  void tail.then(() => {
    if (sessionLocks.get(sessionID) === tail) sessionLocks.delete(sessionID);
  });
  return turn;
}

/** Resolves once `response` has finished, or its connection closed. */
export function whenFinished(response: Parameters<typeof finished>[0]) {
  return new Promise<void>((resolve) => {
    finished(response, () => resolve());
  });
}

// express-session loaded the session before any handler ran, so what the
// request carries may be out of date by the time the lock is held.
async function reload(request: LockableRequest) {
  try {
    await promisify(request.session.reload.bind(request.session))();
  } catch (error) {
    // Session#reload passes store errors through, and reports a session the
    // store does not have with this error.
    if (error instanceof Error && error.message === 'failed to load session') {
      throw new SessionGoneError();
    }
    throw error;
  }
  // reload replaced the request's session object.
  const { session } = request;
  if (session.data == null) throw new SessionGoneError();
  return { session, sessionData: session.data };
}
