import { mediaType } from '@lightmill/log-api/vocabulary';
import express from 'express';
import request from 'supertest';
import { describe, it } from 'vitest';
import { createLogServer } from '../src/app.ts';
import { SQLiteDataStore } from '../src/sqlite-data-store.ts';
import { listen } from './__fixtures__/test-utils.ts';

// The API requires experiment names to be non-empty, but the store accepts
// an empty one.
async function createHostApi(options: { validateResponses?: boolean }) {
  const dataStore = await SQLiteDataStore.open(':memory:');
  await dataStore.withTransaction((tx) =>
    tx.addExperiment({ experimentName: '' }),
  );
  const server = createLogServer({
    dataStore,
    sessionKeys: ['secret'],
    allowCrossOrigin: false,
    secureCookies: false,
    ...options,
  });
  const api = request.agent(await listen(express().use(server.middleware)));
  await api
    .post('/sessions')
    .set('content-type', mediaType)
    .send({ data: { type: 'sessions', attributes: { role: 'host' } } })
    .expect(201);
  return api;
}

describe('createLogServer response validation', () => {
  it('serves responses that do not match the API by default', async () => {
    const api = await createHostApi({});
    await api.get('/experiments').expect(200);
  });

  it('answers 500 to responses that do not match the API when enabled', async () => {
    const api = await createHostApi({ validateResponses: true });
    await api.get('/experiments').expect(500);
  });
});
