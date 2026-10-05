/* eslint-disable no-empty-pattern */
import { mediaType } from '@lightmill/log-api/vocabulary';
import express from 'express';
import session, { type SessionData } from 'express-session';
import request from 'supertest';
import { test as baseTest, describe, onTestFinished, vi } from 'vitest';
import type { DataStore } from '../src/data-store.ts';
import { SQLiteDataStore } from '../src/sqlite-data-store.ts';
import {
  createRunRequest,
  createServerContext,
  host,
  listen,
} from './__fixtures__/test-utils.ts';

const SESSION_MAX_AGE = 60 * 60 * 1000;

type Operation = 'get' | 'set' | 'destroy';
type Gate = () => Promise<void>;

/**
 * Wraps a session store, which makes it a store with nothing but `get`, `set`
 * and `destroy`. The tests decide when its calls go through, so they control
 * how concurrent requests interleave without sleeping.
 */
class GatedSessionStore extends session.Store {
  #inner: session.Store;
  #gates: Record<Operation, Gate[]> = { get: [], set: [], destroy: [] };
  #getWaiters: Array<() => void> = [];
  /** What the store was asked to save, in order. */
  sets: Array<{ data: SessionData['data']; expires: number | undefined }> = [];

  constructor(inner: session.Store) {
    super();
    this.#inner = inner;
  }

  /**
   * The next calls of `operation` wait for these gates, one each. A call whose
   * gate rejects fails with its reason.
   */
  gate(operation: Operation, ...gates: Gate[]) {
    this.#gates[operation].push(...gates);
  }

  /** Settles once the next `get` handed its result back. */
  nextGetDone() {
    return new Promise<void>((resolve) => this.#getWaiters.push(resolve));
  }

  get(
    sid: string,
    callback: (error?: unknown, session?: SessionData | null) => void,
  ) {
    this.#through('get', callback, () =>
      this.#inner.get(sid, (...args) => {
        callback(...args);
        this.#getWaiters.shift()?.();
      }),
    );
  }

  set(sid: string, data: SessionData, callback?: (error?: unknown) => void) {
    this.sets.push({
      data: data.data,
      expires: data.cookie.expires?.getTime(),
    });
    this.#through('set', callback, () => this.#inner.set(sid, data, callback));
  }

  destroy(sid: string, callback?: (error?: unknown) => void) {
    this.#through('destroy', callback, () =>
      this.#inner.destroy(sid, callback),
    );
  }

  #through(
    operation: Operation,
    onError: ((error: unknown) => void) | undefined,
    run: () => void,
  ) {
    const gate = this.#gates[operation].shift();
    if (gate === undefined) return run();
    gate().then(run, onError);
  }
}

/**
 * A store whose `touch` saves the whole session it is given, which is the
 * session as the request holds it when its response ends.
 */
class WholeSessionTouchStore extends GatedSessionStore {
  touch(sid: string, data: SessionData, callback?: (error?: unknown) => void) {
    this.set(sid, data, callback);
  }
}

// supertest only sends a request once it is awaited or ended. This sends it
// now, and gives the response back when it is there.
const send = (test: request.Test) => test.then((response) => response);

// A store call stopped by the test: `reached` settles when it arrives, and it
// goes through once the test calls `release`.
function hold() {
  const reached = Promise.withResolvers<void>();
  const released = Promise.withResolvers<void>();
  return {
    reached: reached.promise,
    release: () => released.resolve(),
    gate: (): Promise<void> => {
      reached.resolve();
      return released.promise;
    },
  };
}

// Lets calls through once `count` of them arrived.
function barrier(count: number): Gate {
  const open = Promise.withResolvers<void>();
  let arrived = 0;
  return () => {
    if (++arrived === count) open.resolve();
    return open.promise;
  };
}

interface Fixture {
  context: {
    dataStore: DataStore;
    sessionStore: GatedSessionStore;
    newSession: () => Promise<request.Agent>;
    createRun: (api: request.Agent) => request.Test;
  };
}

const stores = [
  {
    name: 'SQLite session store',
    innerSessionStore: (dataStore: SQLiteDataStore) =>
      dataStore.getSessionStore(),
  },
  {
    name: 'get/set/destroy-only session store',
    innerSessionStore: () => new session.MemoryStore(),
  },
  {
    name: 'session store whose touch saves the whole session',
    innerSessionStore: () => new session.MemoryStore(),
    touchSavesWholeSession: true,
  },
];

describe.for(stores)(
  'createLogServer: session ordering ($name)',
  ({ innerSessionStore, touchSavesWholeSession = false }) => {
    const test = baseTest.extend<Fixture>({
      context: async ({}, use) => {
        const dataStore = await SQLiteDataStore.open(':memory:');
        const SessionStore = touchSavesWholeSession
          ? WholeSessionTouchStore
          : GatedSessionStore;
        const sessionStore = new SessionStore(innerSessionStore(dataStore));
        const { server } = await createServerContext({
          dataStore,
          sessionStore,
          serverOptions: { sessionMaxAge: SESSION_MAX_AGE },
        });
        const app = await listen(express().use(server.middleware));
        const { experimentId } = await dataStore.withTransaction((tx) =>
          tx.addExperiment({ experimentName: 'my-experiment-name' }),
        );
        await use({
          dataStore,
          sessionStore,
          async newSession() {
            const api = request.agent(app).host(host);
            await api
              .post('/sessions')
              .set('content-type', mediaType)
              .send({
                data: { type: 'sessions', attributes: { role: 'participant' } },
              })
              .expect(201);
            return api;
          },
          createRun: (api) => createRunRequest(api, experimentId),
        });
      },
    });

    test('lets only one of two concurrent run creations of a session through', async ({
      expect,
      context: { dataStore, sessionStore, newSession, createRun },
    }) => {
      const api = await newSession();
      // Both requests load the session before either creates its run.
      const loaded = barrier(2);
      sessionStore.gate('get', loaded, loaded);
      const responses = await Promise.all([createRun(api), createRun(api)]);
      expect(responses.map((r) => r.status).sort()).toEqual([201, 403]);
      expect(responses.find((r) => r.status === 403)?.body).toEqual({
        errors: [expect.objectContaining({ code: 'ONGOING_RUNS' })],
      });
      await expect(dataStore.getRuns()).resolves.toHaveLength(1);
      const { body } = await api.get('/sessions/current').expect(200);
      expect(body.data.relationships.runs.data).toHaveLength(1);
    });

    test('keeps the run a request saved once the next request ends', async ({
      expect,
      context: { sessionStore, newSession, createRun },
    }) => {
      const api = await newSession();
      const loaded = barrier(2);
      sessionStore.gate('get', loaded, loaded);
      // express-session saves or touches the session when each response ends.
      // Done after the lock was released, that write could put back a session
      // without the run.
      await Promise.all([createRun(api), createRun(api)]);
      await createRun(api).expect(403);
      const { body } = await api.get('/sessions/current').expect(200);
      expect(body.data.relationships.runs.data).toHaveLength(1);
    });

    test('does not bring back a session that was deleted', async ({
      context: { sessionStore, newSession, createRun },
    }) => {
      const api = await newSession();
      const loaded = barrier(3);
      sessionStore.gate('get', loaded, loaded, loaded);
      await Promise.all([
        createRun(api),
        createRun(api),
        api.delete('/sessions/current'),
      ]);
      await api.get('/sessions/current').expect(404);
    });

    test('refreshes the expiry of the session it saves', async ({
      expect,
      context: { sessionStore, newSession, createRun },
    }) => {
      vi.useFakeTimers({
        now: new Date('2025-01-01T00:00:00Z'),
        toFake: ['Date'],
      });
      onTestFinished(() => void vi.useRealTimers());
      const api = await newSession();
      vi.setSystemTime(new Date('2025-01-01T00:10:00Z'));
      await createRun(api).expect(201);
      expect(sessionStore.sets.at(-1)?.expires).toBe(
        Date.parse('2025-01-01T00:10:00Z') + SESSION_MAX_AGE,
      );
    });

    test('does not make different sessions wait for each other', async ({
      expect,
      context: { sessionStore, newSession, createRun },
    }) => {
      const [api, otherApi] = [await newSession(), await newSession()];
      const held = hold();
      sessionStore.gate('set', held.gate);
      const first = send(createRun(api));
      await held.reached;
      await createRun(otherApi).expect(201);
      held.release();
      expect((await first).status).toBe(201);
    });

    test('orders a creation and a DELETE of the same session', async ({
      expect,
      context: { dataStore, sessionStore, newSession, createRun },
    }) => {
      const api = await newSession();
      // Both requests load the session before either of them writes it.
      const loaded = barrier(2);
      sessionStore.gate('get', loaded, loaded);
      const [created, deleted] = await Promise.all([
        createRun(api),
        api.delete('/sessions/current'),
      ]);
      const runs = await dataStore.getRuns();
      expect(deleted.status).toBe(200);
      if (created.status === 201) {
        expect(runs).toHaveLength(1);
      } else {
        expect(created.status).toBe(403);
        expect(created.body).toEqual({
          errors: [expect.objectContaining({ code: 'SESSION_REQUIRED' })],
        });
        expect(runs).toHaveLength(0);
      }
      // The session is never alive once the DELETE answered.
      await api.get('/sessions/current').expect(404);
    });

    test('finishes a creation whose client left, before the next one', async ({
      expect,
      context: { sessionStore, newSession, createRun },
    }) => {
      const api = await newSession();
      const held = hold();
      sessionStore.gate('set', held.gate);
      const first = createRun(api);
      // The client leaves after sending, so there is no response to wait for.
      first.end(() => {});
      await held.reached;
      first.abort();
      const secondLoaded = sessionStore.nextGetDone();
      const second = send(createRun(api));
      await secondLoaded;
      held.release();
      const response = await second;
      expect(response.status).toBe(403);
      expect(response.body).toEqual({
        errors: [expect.objectContaining({ code: 'ONGOING_RUNS' })],
      });
    });

    test('releases a session when saving it fails', async ({
      expect,
      context: { dataStore, sessionStore, newSession, createRun },
    }) => {
      const api = await newSession();
      sessionStore.gate('set', () => Promise.reject(new Error('disk full')));
      await createRun(api).expect(500);
      // The run it created is not in the session, so it blocks nothing.
      await createRun(api).expect(201);
      await expect(dataStore.getRuns()).resolves.toHaveLength(2);
    });

    test('releases a session when reading it fails', async ({
      context: { sessionStore, newSession, createRun },
    }) => {
      const api = await newSession();
      // The first read is the one every request does before its handler runs.
      sessionStore.gate(
        'get',
        () => Promise.resolve(),
        () => Promise.reject(new Error('connection lost')),
      );
      await createRun(api).expect(500);
      await createRun(api).expect(201);
    });

    test('releases a session when destroying it fails', async ({
      context: { sessionStore, newSession },
    }) => {
      const api = await newSession();
      sessionStore.gate('destroy', () =>
        Promise.reject(new Error('disk full')),
      );
      await api.delete('/sessions/current').expect(500);
      // The session is still there, so it can be deleted again.
      await api.delete('/sessions/current').expect(200);
    });
  },
);
