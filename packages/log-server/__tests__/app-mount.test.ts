import express from 'express';
import request from 'supertest';
import { describe, it } from 'vitest';
import { createMockStore } from '../__mocks__/mock-data-store.ts';
import { MockSessionStore } from '../__mocks__/mock-session-store.ts';
import { apiMediaType } from '../src/app-utils.ts';
import { LogServer } from '../src/app.js';
import { apiContentTypeRegExp } from './test-utils.js';

describe('LogServer', () => {
  it('can be mounted on a sub path', async () => {
    let sessionStore = new MockSessionStore();
    let store = createMockStore();
    let server = LogServer({
      baseUrl: '/api',
      store,
      sessionStore,
      sessionKeys: ['secret'],
      hostPassword: 'host password',
      hostUser: 'host user',
      secureCookies: false,
    });
    let app = express().use('/api', server.middleware);
    let api = request.agent(app).host('lightmill-test.com');

    await api
      .post('/api/sessions')
      .set('content-type', apiMediaType)
      .send({ data: { type: 'sessions', attributes: { role: 'participant' } } })
      .expect(201)
      .expect('Content-Type', apiContentTypeRegExp);
  });
});
