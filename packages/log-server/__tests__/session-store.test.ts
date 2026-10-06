import { mediaType } from '@lightmill/log-api/vocabulary';
import SQLiteDB from 'better-sqlite3';
import express from 'express';
import session, { type SessionData } from 'express-session';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLogServer } from '../src/app.ts';
import { SQLiteDataStore } from '../src/sqlite-data-store.ts';
import { listen } from './__fixtures__/test-utils.ts';

let directory: string;
let database: string;
beforeEach(() => {
  directory = mkdtempSync(path.join(os.tmpdir(), 'lightmill-session-store-'));
  database = path.join(directory, 'data.sqlite');
});
afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

async function openServer(options: { sessionMaxAge?: number } = {}) {
  await SQLiteDataStore.migrateDatabase(database);
  const dataStore = await SQLiteDataStore.open(database);
  const middleware = createLogServer({
    dataStore,
    sessionStore: dataStore.getSessionStore(),
    sessionKeys: ['secret'],
    validateResponses: true,
    allowCrossOrigin: false,
    ...options,
  }).middleware;
  const server = await listen(express().use(middleware));
  return {
    // A plain request, so no cookie is carried over unless the test sends it.
    api: () => request(server),
    close: async () => {
      server.close();
      server.closeAllConnections();
      await dataStore.close();
    },
  };
}

async function createSession(api: request.Agent) {
  const response = await api
    .post('/sessions')
    .set('Content-Type', mediaType)
    .send({ data: { type: 'sessions', attributes: { role: 'participant' } } })
    .expect(201);
  const cookies = (response.get('Set-Cookie') ?? []).map(
    (cookie) => cookie.split(';', 1)[0] ?? cookie,
  );
  expect(cookies).not.toHaveLength(0);
  return cookies;
}

function toError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error));
}

describe('getSessionStore through createLogServer', () => {
  it('keeps a session after the server restarts', async () => {
    const first = await openServer({ sessionMaxAge: 60_000 });
    const cookie = await createSession(first.api());
    await first.close();

    const second = await openServer({ sessionMaxAge: 60_000 });
    const restored = await second
      .api()
      .get('/sessions/current')
      .set('Cookie', cookie)
      .expect(200);
    expect(restored.body.data.attributes.role).toBe('participant');
    await second.close();
  });

  it('keeps a session whose cookie has no expiry', async () => {
    const first = await openServer();
    const cookie = await createSession(first.api());
    await first.close();

    const second = await openServer();
    await second
      .api()
      .get('/sessions/current')
      .set('Cookie', cookie)
      .expect(200);
    await second.close();
  });

  it('forgets a deleted session', async () => {
    const server = await openServer();
    const cookie = await createSession(server.api());
    await server
      .api()
      .delete('/sessions/current')
      .set('Cookie', cookie)
      .expect(200);
    await server
      .api()
      .get('/sessions/current')
      .set('Cookie', cookie)
      .expect(404);
    await server.close();
  });
});

describe('getSessionStore', () => {
  const day = 24 * 60 * 60 * 1000;
  const sessionData = (expires?: Date): SessionData => ({
    // @types/express-session declares the Cookie constructor without options.
    cookie: Object.assign(new session.Cookie(), expires ? { expires } : {}),
    data: { role: 'participant', runs: [] },
  });

  async function openStore() {
    await SQLiteDataStore.migrateDatabase(database);
    const dataStore = await SQLiteDataStore.open(database);
    const store = dataStore.getSessionStore();
    const get = (sid: string) =>
      new Promise<SessionData | null | undefined>((resolve, reject) =>
        store.get(sid, (error, data) =>
          error ? reject(toError(error)) : resolve(data),
        ),
      );
    const set = (sid: string, data: SessionData) =>
      new Promise<void>((resolve, reject) =>
        store.set(sid, data, (error) =>
          error ? reject(toError(error)) : resolve(),
        ),
      );
    return { dataStore, store, get, set };
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the same store on every call', async () => {
    const { dataStore, store } = await openStore();
    expect(dataStore.getSessionStore()).toBe(store);
    await dataStore.close();
  });

  it('does not return an expired session', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { dataStore, get, set } = await openStore();
    await set('sid', sessionData(new Date(Date.now() + 1000)));
    expect(await get('sid')).not.toBeNull();
    vi.advanceTimersByTime(1000);
    expect(await get('sid')).toBeNull();
    await dataStore.close();
  });

  it('keeps a session without cookie expiry for one day', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { dataStore, get, set } = await openStore();
    await set('sid', sessionData());
    vi.advanceTimersByTime(day - 1);
    expect(await get('sid')).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(await get('sid')).toBeNull();
    await dataStore.close();
  });

  it('lets the cookie expiry win over the fallback', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { dataStore, get, set } = await openStore();
    await set('sid', sessionData(new Date(Date.now() + 3 * day)));
    vi.advanceTimersByTime(2 * day);
    expect(await get('sid')).not.toBeNull();
    await dataStore.close();
  });

  it('tells to migrate when the session table is missing', async () => {
    // open() rejects a database without the table, so drop it afterwards.
    await SQLiteDataStore.migrateDatabase(database);
    const dataStore = await SQLiteDataStore.open(database);
    new SQLiteDB(database).prepare('DROP TABLE lightmill_sessions').run();
    const store = dataStore.getSessionStore();
    const error = await new Promise<unknown>((resolve) =>
      store.get('sid', resolve),
    );
    expect(error).toEqual(
      expect.objectContaining({
        message: expect.stringContaining('migrateDatabase()'),
        cause: expect.any(Error),
      }),
    );
    await dataStore.close();
  });

  it('reports a corrupt session instead of hanging', async () => {
    const { dataStore, store, set } = await openStore();
    await set('sid', sessionData(new Date(Date.now() + day)));
    new SQLiteDB(database)
      .prepare("UPDATE lightmill_sessions SET data = 'not json'")
      .run();
    const error = await new Promise<unknown>((resolve) =>
      store.get('sid', resolve),
    );
    expect(error).toBeInstanceOf(SyntaxError);
    await dataStore.close();
  });

  it('fails after the data store is closed', async () => {
    const { dataStore, store } = await openStore();
    await dataStore.close();
    const error = await new Promise<unknown>((resolve) =>
      store.get('sid', resolve),
    );
    expect(error).toEqual(
      expect.objectContaining({
        message: expect.stringContaining('destroyed'),
      }),
    );
  });
});
