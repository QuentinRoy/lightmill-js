/* eslint-disable no-empty-pattern */
import express from 'express';
import session, { type SessionData } from 'express-session';
import request from 'supertest';
import { test as baseTest, describe } from 'vitest';
import { apiMediaType } from '../src/api.ts';
import type { DataStore } from '../src/data-store.ts';
import { SQLiteDataStore } from '../src/sqlite-data-store.ts';
import {
  createServerContext,
  host,
  listen,
} from './__fixtures__/test-utils.ts';

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
];

describe.for(stores)(
  'LogServer: session ordering ($name)',
  ({ innerSessionStore }) => {
    const test = baseTest.extend<Fixture>({
      context: async ({}, use) => {
        const dataStore = await SQLiteDataStore.open(':memory:');
        const sessionStore = new GatedSessionStore(
          innerSessionStore(dataStore),
        );
        const { server } = await createServerContext({
          dataStore,
          sessionStore,
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
              .set('content-type', apiMediaType)
              .send({
                data: { type: 'sessions', attributes: { role: 'participant' } },
              })
              .expect(201);
            return api;
          },
          createRun: (api) =>
            api
              .post('/runs')
              .set('content-type', apiMediaType)
              .send({
                data: {
                  type: 'runs',
                  attributes: { status: 'idle', name: null },
                  relationships: {
                    experiment: {
                      data: { type: 'experiments', id: experimentId },
                    },
                  },
                },
              }),
        });
      },
    });

    test('lets only one of two concurrent creations of a session through', async ({
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

    test('does not make different sessions wait for each other', async ({
      expect,
      context: { sessionStore, newSession, createRun },
    }) => {
      const [api, otherApi] = [await newSession(), await newSession()];
      const held = hold();
      sessionStore.gate('set', held.gate);
      const first = createRun(api).then((response) => response);
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
      first.end(() => {});
      await held.reached;
      first.abort();
      const secondLoaded = sessionStore.nextGetDone();
      const second = createRun(api).then((response) => response);
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
  },
);
