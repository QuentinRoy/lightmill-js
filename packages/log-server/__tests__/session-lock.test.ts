import type { Request } from 'express';
import session, { type SessionData } from 'express-session';
import { setImmediate as macrotask } from 'node:timers/promises';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { lockSession, SessionGoneError } from '../src/session-lock.ts';

type Data = SessionData['data'];

// Answers in microtasks, so a test can flush everything that is ready to run
// with a single macrotask.
class FakeSessionStore extends session.Store {
  #sessions = new Map<string, string>();
  failNextGet: Error | undefined;

  get(
    sid: string,
    callback: (error?: unknown, session?: SessionData | null) => void,
  ) {
    const failure = this.failNextGet;
    this.failNextGet = undefined;
    queueMicrotask(() => {
      if (failure) return callback(failure);
      const stored = this.#sessions.get(sid);
      callback(null, stored === undefined ? null : JSON.parse(stored));
    });
  }

  set(sid: string, data: SessionData, callback?: (error?: unknown) => void) {
    queueMicrotask(() => {
      this.#sessions.set(sid, JSON.stringify(data));
      callback?.();
    });
  }

  destroy(sid: string, callback?: (error?: unknown) => void) {
    queueMicrotask(() => {
      this.#sessions.delete(sid);
      callback?.();
    });
  }

  read(sid: string): SessionData | undefined {
    const stored = this.#sessions.get(sid);
    return stored === undefined ? undefined : JSON.parse(stored);
  }
}

const maxAge = 1000;
const newCookie = () => {
  const cookie = new session.Cookie();
  cookie.maxAge = maxAge;
  cookie.originalMaxAge = maxAge;
  return cookie;
};
const data = (runs: string[]): Data => ({ role: 'participant', runs });

function setup(sessions: Record<string, Data> = { a: data([]), b: data([]) }) {
  const store = new FakeSessionStore();
  for (const [sid, sessionData] of Object.entries(sessions)) {
    store.set(sid, { cookie: newCookie(), data: sessionData });
  }
  const lock = <Response>(
    sessionID: string,
    fn: Parameters<typeof lockSession<Response>>[2],
    // By default, the response finishes as soon as fn settles.
    responseFinished?: Promise<unknown>,
  ) => {
    // Sessions only use the sessionID and sessionStore of their request.
    const request = { sessionID, sessionStore: store } as unknown as Request;
    // What express-session loaded when the request came in, which the lock
    // must not trust.
    store.createSession(request, {
      cookie: newCookie(),
      data: data(['stale']),
    });
    const response = later();
    const result = lockSession(
      request,
      responseFinished ?? response.promise,
      fn,
    );
    const finish = () => response.resolve();
    void result.then(finish, finish);
    return result;
  };
  return { store, lock };
}

// Settles later, when the test says so.
function later() {
  const { promise, resolve } = Promise.withResolvers<void>();
  return { promise, resolve };
}

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2025-01-01T00:00:00Z'), toFake: ['Date'] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('lockSession', () => {
  test('runs the requests of a session one after the other', async () => {
    const { lock } = setup();
    const events: string[] = [];
    const first = later();
    const run = (name: string, wait?: Promise<void>) =>
      lock('a', async () => {
        events.push(`${name} starts`);
        await wait;
        events.push(`${name} ends`);
      });
    const all = Promise.all([
      run('first', first.promise),
      run('second'),
      run('third'),
    ]);
    await macrotask();
    expect(events).toEqual(['first starts']);
    first.resolve();
    await all;
    expect(events).toEqual([
      'first starts',
      'first ends',
      'second starts',
      'second ends',
      'third starts',
      'third ends',
    ]);
  });

  test('gives the next request what the previous one saved', async () => {
    const { lock } = setup();
    const add = (runId: string) =>
      lock('a', async ({ sessionData, save }) => {
        await save({ ...sessionData, runs: [...sessionData.runs, runId] });
      });
    // Both requests were ready at the same time, so neither can have seen the
    // other's run without the lock.
    await Promise.all([add('1'), add('2')]);
    const seen = await lock('a', async ({ sessionData }) => sessionData.runs);
    expect(seen).toEqual(['1', '2']);
  });

  test('does not make a session wait for another one', async () => {
    const { lock } = setup();
    const held = later();
    const first = lock('a', () => held.promise);
    await expect(lock('b', async () => 'done')).resolves.toBe('done');
    held.resolve();
    await first;
  });

  test('lets the next request in when a request fails', async () => {
    const { lock } = setup();
    const failure = new Error('boom');
    const first = lock('a', () => Promise.reject(failure));
    const second = lock('a', async () => 'done');
    await expect(first).rejects.toBe(failure);
    await expect(second).resolves.toBe('done');
  });

  test('lets the next request in when the store cannot read', async () => {
    const { store, lock } = setup();
    const failure = new Error('connection lost');
    store.failNextGet = failure;
    const first = lock('a', async () => 'unreachable');
    const second = lock('a', async () => 'done');
    await expect(first).rejects.toBe(failure);
    await expect(second).resolves.toBe('done');
  });

  test('keeps the lock until the request is done, even if nobody waits for it', async () => {
    const { lock } = setup();
    const held = later();
    const events: string[] = [];
    // Nobody awaits the first request, like a client that left.
    void lock('a', async () => {
      await held.promise;
      events.push('first ends');
    });
    const second = lock('a', async () => void events.push('second starts'));
    await macrotask();
    expect(events).toEqual([]);
    held.resolve();
    await second;
    expect(events).toEqual(['first ends', 'second starts']);
  });

  test('keeps the lock until the response has finished', async () => {
    const { lock } = setup();
    const response = later();
    const events: string[] = [];
    const first = lock('a', async () => 'first', response.promise);
    const second = lock('a', async () => void events.push('second starts'));
    await first;
    await macrotask();
    expect(events).toEqual([]);
    response.resolve();
    await second;
    expect(events).toEqual(['second starts']);
  });

  test('does not run a request whose session is gone', async () => {
    const { lock } = setup();
    const fn = vi.fn(async () => 'unreachable');
    await expect(lock('unknown', fn)).rejects.toBeInstanceOf(SessionGoneError);
    expect(fn).not.toHaveBeenCalled();
  });

  test('destroys the session before a request queued behind it reads', async () => {
    const { store, lock } = setup();
    const held = later();
    const destroying = lock('a', async ({ destroy }) => {
      await held.promise;
      await destroy();
    });
    const creating = lock('a', async () => 'unreachable');
    held.resolve();
    await destroying;
    await expect(creating).rejects.toBeInstanceOf(SessionGoneError);
    expect(store.read('a')).toBeUndefined();
  });

  test('saves before a request queued behind it destroys', async () => {
    const { store, lock } = setup();
    const held = later();
    const creating = lock('a', async ({ sessionData, save }) => {
      await held.promise;
      await save({ ...sessionData, runs: ['1'] });
    });
    const destroying = lock('a', ({ destroy }) => destroy());
    held.resolve();
    await Promise.all([creating, destroying]);
    expect(store.read('a')).toBeUndefined();
  });

  test('moves the expiry of the session it saves', async () => {
    const { store, lock } = setup();
    vi.setSystemTime(new Date('2025-01-01T00:10:00Z'));
    await lock('a', ({ sessionData, save }) => save(sessionData));
    expect(store.read('a')?.cookie.expires).toBe(
      new Date(Date.parse('2025-01-01T00:10:00Z') + maxAge).toISOString(),
    );
  });
});
