import { mediaType } from '@lightmill/log-api/vocabulary';
import express from 'express';
import request from 'supertest';
import { describe, it } from 'vitest';
import { createLogServer } from '../src/app.ts';
import {
  createServerContext,
  listen,
  storeTypes,
} from './__fixtures__/test-utils.ts';

describe.for(storeTypes)('createLogServer (%s)', (storeType) => {
  it('can be mounted on a sub path', async () => {
    let { dataStore, sessionStore } = await createServerContext({
      type: storeType,
    });
    let server = createLogServer({
      baseUrl: '/api',
      dataStore,
      sessionStore,
      sessionKeys: ['secret'],
    });
    let app = express().use('/api', server.middleware);
    let api = request.agent(await listen(app)).host('lightmill-test.com');

    await api
      .post('/sessions')
      .set('content-type', mediaType)
      .send({ data: { type: 'sessions', attributes: { role: 'participant' } } })
      .expect(404, {});
  });
});
