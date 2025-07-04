/* eslint-disable no-empty-pattern */

import express, { type Application } from 'express';
import { Store as SessionStore } from 'express-session';
import request from 'supertest';
import { describe, test as vitestTest } from 'vitest';
import { apiMediaType, type ServerRequestContent } from '../src/app-utils.ts';
import { LogServer } from '../src/app.ts';
import type { DataStore } from '../src/data-store.ts';
import {
  apiContentTypeRegExp,
  dataStoreCreators,
  sessionStoreCreators,
  storeTypes,
  type WithMockedMethods,
} from './test-utils.ts';

type BaseFixture = {
  dataStore: WithMockedMethods<DataStore>;
  app: Application;
  api: request.Agent;
  sessionStore: WithMockedMethods<SessionStore>;
};

const suite = storeTypes.map((storeType) => ({
  storeType,
  test: vitestTest.extend<BaseFixture>({
    sessionStore: async ({}, use) => {
      await use(await sessionStoreCreators[storeType]());
    },
    dataStore: async ({}, use) => {
      await use(await dataStoreCreators[storeType]());
    },
    // @ts-expect-error There is something weird with express' Application type
    // that messes up with vitest's fixtures, but it's not a big deal.
    app: async ({ dataStore, sessionStore }, use) => {
      let server = LogServer({
        dataStore: dataStore,
        sessionStore,
        sessionKeys: ['secret'],
        hostPassword: 'host password',
        hostUser: 'host user',
        secureCookies: false,
      });
      let app = express().use(server.middleware);
      await use(app satisfies Application);
    },
    api: async ({ app }, use) => {
      let api = request.agent(app);
      await use(api);
    },
  }),
}));

describe.for(suite)(
  'LogServer: post /sessions ($storeType)',
  ({ test: it }) => {
    it('can set up a participant session', async ({ api }) => {
      await api
        .post('/sessions')
        .set('content-type', apiMediaType)
        .send({
          data: { type: 'sessions', attributes: { role: 'participant' } },
        } satisfies ServerRequestContent<'/sessions', 'post'>['body'])
        .expect(201, {
          data: {
            id: 'current',
            type: 'sessions',
            attributes: { role: 'participant' },
            relationships: { runs: { data: [] } },
          },
        })
        .expect('Content-Type', apiContentTypeRegExp);
    });

    it('refuses to create a session for an unknown role', async ({ api }) => {
      await api
        .post('/sessions')
        .set('content-type', apiMediaType)
        .send({
          data: {
            type: 'sessions',
            attributes: { role: 'something-else' as 'participant' },
          },
        } satisfies ServerRequestContent<'/sessions', 'post'>['body'])
        .expect(400);
    });

    it('always creates a host role if there are no host passwords set on the server', async ({
      dataStore,
    }) => {
      let server = LogServer({
        dataStore: dataStore,
        sessionKeys: ['secret'],
        hostUser: 'host user',
      });
      let app = express();
      app.use(server.middleware);
      let api = request.agent(app);
      await api
        .post('/sessions')
        .set('content-type', apiMediaType)
        .send({ data: { type: 'sessions', attributes: { role: 'host' } } })
        .expect(201, {
          data: {
            type: 'sessions',
            id: 'current',
            attributes: { role: 'host' },
            relationships: { runs: { data: [] } },
          },
        })
        .expect('Content-Type', apiContentTypeRegExp);
    });

    it('creates a host session if the provided password is correct', async ({
      api,
    }) => {
      await api
        .post('/sessions')
        .auth('host user', 'host password', { type: 'basic' })
        .set('content-type', apiMediaType)
        .send({ data: { type: 'sessions', attributes: { role: 'host' } } })
        .expect('Set-Cookie', /lightmill-session-id=.+;\s*Path=\/;\s*HttpOnly/)
        .expect(201, {
          data: {
            id: 'current',
            type: 'sessions',
            attributes: { role: 'host' },
            relationships: { runs: { data: [] } },
          },
        })
        .expect('Content-Type', apiContentTypeRegExp);
    });

    it('refuses to create a host session if the provided password is incorrect', async ({
      api,
    }) => {
      await api
        .post('/sessions')
        .auth('host user', 'not the host password', { type: 'basic' })
        .set('content-type', apiMediaType)
        .send({ data: { type: 'sessions', attributes: { role: 'host' } } })
        .expect(403, {
          errors: [
            {
              status: 'Forbidden',
              code: 'INVALID_CREDENTIALS',
              detail: 'Invalid credentials for role: host',
            },
          ],
        })
        .expect('Content-Type', apiContentTypeRegExp);
      await api.get('/sessions/current').expect(404);
    });

    it('refuses to create a host session if no password is provided and there is an host password', async ({
      api,
    }) => {
      await api
        .post('/sessions')
        .set('content-type', apiMediaType)
        .send({ data: { type: 'sessions', attributes: { role: 'host' } } })
        .expect(403, {
          errors: [
            {
              status: 'Forbidden',
              code: 'INVALID_CREDENTIALS',
              detail: 'Invalid credentials for role: host',
            },
          ],
        })
        .expect('Content-Type', apiContentTypeRegExp);
      await api.get('/sessions/current').expect(404);
    });

    it('refuses to create a session if there is already one', async ({
      api,
    }) => {
      await api
        .post('/sessions')
        .set('content-type', apiMediaType)
        .send({
          data: { type: 'sessions', attributes: { role: 'participant' } },
        })
        .expect(201);
      await api
        .post('/sessions')
        .set('content-type', apiMediaType)
        .send({
          data: { type: 'sessions', attributes: { role: 'participant' } },
        })
        .expect(409, {
          errors: [
            {
              status: 'Conflict',
              code: 'SESSION_EXISTS',
              detail: 'Session already exists, delete it first',
            },
          ],
        })
        .expect('Content-Type', apiContentTypeRegExp);
    });
  },
);

describe.for(suite)(
  'LogServer: get /sessions/{id} ($storeType)',
  ({ test: it }) => {
    it('returns a 404 error if no sessions have been created', async ({
      api,
    }) => {
      await api
        .get('/sessions/current')
        .expect(404, {
          errors: [
            {
              status: 'Not Found',
              code: 'SESSION_NOT_FOUND',
              detail: 'Session "current" not found',
            },
          ],
        })
        .expect('Content-Type', apiContentTypeRegExp);
    });

    it('returns a 404 error if trying to get any session other than current', async ({
      api,
    }) => {
      await api
        .post('/sessions')
        .set('content-type', apiMediaType)
        .send({
          data: { type: 'sessions', attributes: { role: 'participant' } },
        })
        .expect(201);
      await api
        .get('/sessions/something-else')
        .expect(404, {
          errors: [
            {
              status: 'Not Found',
              code: 'SESSION_NOT_FOUND',
              detail: 'Session "something-else" not found',
            },
          ],
        })
        .expect('Content-Type', apiContentTypeRegExp);
    });

    it('returns a participant session', async ({ api }) => {
      await api
        .post('/sessions')
        .set('content-type', apiMediaType)
        .send({
          data: { type: 'sessions', attributes: { role: 'participant' } },
        })
        .expect(201);
      await api
        .get(`/sessions/current`)
        .expect(200, {
          data: {
            type: 'sessions',
            id: 'current',
            attributes: { role: 'participant' },
            relationships: { runs: { data: [] } },
          },
        })
        .expect('Content-Type', apiContentTypeRegExp);
    });

    it('returns a host session', async ({ api }) => {
      await api
        .post('/sessions')
        .auth('host user', 'host password')
        .set('content-type', apiMediaType)
        .send({ data: { type: 'sessions', attributes: { role: 'host' } } })
        .expect(201);
      await api
        .get('/sessions/current')
        .expect(200, {
          data: {
            type: 'sessions',
            id: 'current',
            attributes: { role: 'host' },
            relationships: { runs: { data: [] } },
          },
        })
        .expect('Content-Type', apiContentTypeRegExp);
    });
  },
);

describe.for(suite)(
  'LogServer: delete /sessions/{id} ($storeType)',
  ({ test: it }) => {
    it('clears the current session', async ({ api }) => {
      await api
        .post('/sessions')
        .set('content-type', apiMediaType)
        .send({
          data: { type: 'sessions', attributes: { role: 'participant' } },
        })
        .expect(201);
      await api.get('/sessions/current').expect(200);
      await api.delete('/sessions/current').expect(200, { data: null });
      await api.get('/sessions/current').expect(404);
    });

    it('lets a new session be created after an existing one has been deleted', async ({
      api,
    }) => {
      await api
        .post('/sessions')
        .set('content-type', apiMediaType)
        .send({
          data: { type: 'sessions', attributes: { role: 'participant' } },
        })
        .expect(201);
      await api.delete('/sessions/current').expect(200);
      await api.get('/sessions/current').expect(404);
      await api
        .post('/sessions')
        .auth('host user', 'host password')
        .set('content-type', apiMediaType)
        .send({ data: { type: 'sessions', attributes: { role: 'host' } } })
        .expect(201);
      await api
        .get('/sessions/current')
        .expect(200, {
          data: {
            type: 'sessions',
            id: 'current',
            attributes: { role: 'host' },
            relationships: { runs: { data: [] } },
          },
        })
        .expect('Content-Type', apiContentTypeRegExp);
      await api.delete('/sessions/current').expect(200);
      await api.get('/sessions/current').expect(404);
      await api
        .post('/sessions')
        .set('content-type', apiMediaType)
        .send({
          data: { type: 'sessions', attributes: { role: 'participant' } },
        })
        .expect(201);
      await api
        .get('/sessions/current')
        .expect(200, {
          data: {
            type: 'sessions',
            id: 'current',
            attributes: { role: 'participant' },
            relationships: { runs: { data: [] } },
          },
        })
        .expect('Content-Type', apiContentTypeRegExp);
    });
  },
);
