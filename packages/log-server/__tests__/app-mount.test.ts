import express from 'express';
import request from 'supertest';
import { describe, it } from 'vitest';
import { apiMediaType } from '../src/app-utils.ts';
import { LogServer } from '../src/app.ts';
import { createServerContext, storeTypes } from './test-utils.ts';

describe.for(storeTypes)('LogServer (%s)', (storeType) => {
  it('can be mounted on a sub path', async () => {
    let { dataStore, sessionStore } = await createServerContext({
      type: storeType,
    });
    let server = LogServer({
      baseUrl: '/api',
      dataStore,
      sessionStore,
      sessionKeys: ['secret'],
    });
    let app = express().use('/api', server.middleware);
    let api = request.agent(app).host('lightmill-test.com');

    await api
      .post('/sessions')
      .set('content-type', apiMediaType)
      .send({ data: { type: 'sessions', attributes: { role: 'participant' } } })
      .expect(404, {});
  });
});
