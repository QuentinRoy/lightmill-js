/* eslint-disable no-empty-pattern */

import { mediaType } from '@lightmill/log-api/vocabulary';
import express, { type Application } from 'express';
import { Store as SessionStore } from 'express-session';
import request from 'supertest';
import { describe, expect, test as vitestTest } from 'vitest';
import { createLogServer } from '../src/app.ts';
import type { DataStore } from '../src/data-store.ts';
import {
  apiContentTypeRegExp,
  dataStoreCreators,
  listen,
  sessionStoreCreators,
  storeTypes,
  type WithMockedMethods,
} from './__fixtures__/test-utils.ts';

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
      let server = createLogServer({
        dataStore: dataStore,
        sessionStore,
        sessionKeys: ['secret'],
        validateResponses: true,
        hostPassword: 'host password',
        hostUser: 'host user',
        allowCrossOrigin: false,
        secureCookies: false,
      });
      let app = express().use(server.middleware);
      await use(app);
    },
    api: async ({ app }, use) => {
      let api = request.agent(await listen(app));
      await use(api);
    },
  }),
}));

vitestTest('same-origin sessions set a usable cookie on HTTP', async () => {
  let dataStore = await dataStoreCreators[storeTypes[0]]();
  let app = express().use(
    createLogServer({
      dataStore,
      sessionKeys: ['secret'],
      validateResponses: true,
      allowCrossOrigin: false,
    }).middleware,
  );
  let api = request.agent(await listen(app));
  let response = await api
    .post('/sessions')
    .set('content-type', mediaType)
    .send({ data: { type: 'sessions', attributes: { role: 'participant' } } })
    .expect(201);

  expect(response.headers['set-cookie']).toEqual([
    expect.stringMatching(/; HttpOnly; SameSite=Strict$/),
  ]);
  await api.get('/sessions/current').expect(200);
});

vitestTest('default sessions require HTTPS for a cookie', async () => {
  let dataStore = await dataStoreCreators[storeTypes[0]]();
  let app = express().use(
    createLogServer({
      dataStore,
      sessionKeys: ['secret'],
      validateResponses: true,
    }).middleware,
  );
  let response = await request(await listen(app))
    .post('/sessions')
    .set('content-type', mediaType)
    .send({ data: { type: 'sessions', attributes: { role: 'participant' } } })
    .expect(201);

  expect(response.headers['set-cookie']).toBeUndefined();
});

describe.for(suite)(
  'createLogServer: post /sessions ($storeType)',
  ({ test: it }) => {
    it('can set up a participant session', async ({ api }) => {
      await api
        .post('/sessions')
        .set('content-type', mediaType)
        .send({
          data: { type: 'sessions', attributes: { role: 'participant' } },
        })
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
        .set('content-type', mediaType)
        .send({
          data: {
            type: 'sessions',
            attributes: { role: 'something-else' as 'participant' },
          },
        })
        .expect(400);
    });

    it('always creates a host role if there are no host passwords set on the server', async ({
      dataStore,
    }) => {
      let server = createLogServer({
        dataStore: dataStore,
        sessionKeys: ['secret'],
        validateResponses: true,
        hostUser: 'host user',
      });
      let app = express();
      app.use(server.middleware);
      let api = request.agent(await listen(app));
      await api
        .post('/sessions')
        .set('content-type', mediaType)
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
        .set('content-type', mediaType)
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
        .set('content-type', mediaType)
        .send({ data: { type: 'sessions', attributes: { role: 'host' } } })
        .expect(403, {
          errors: [
            {
              status: 'Forbidden',
              code: 'INVALID_CREDENTIALS',
              detail: 'Invalid credentials for role: host. Check the password.',
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
        .set('content-type', mediaType)
        .send({ data: { type: 'sessions', attributes: { role: 'host' } } })
        .expect(403, {
          errors: [
            {
              status: 'Forbidden',
              code: 'MISSING_CREDENTIALS',
              detail:
                'Authentication is required for role: host. Provide credentials in the "authorization" header.',
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
        .set('content-type', mediaType)
        .send({
          data: { type: 'sessions', attributes: { role: 'participant' } },
        })
        .expect(201);
      await api
        .post('/sessions')
        .set('content-type', mediaType)
        .send({
          data: { type: 'sessions', attributes: { role: 'participant' } },
        })
        .expect(409, {
          errors: [
            {
              status: 'Conflict',
              code: 'SESSION_EXISTS',
              detail: 'A session already exists. Delete it first.',
            },
          ],
        })
        .expect('Content-Type', apiContentTypeRegExp);
    });
  },
);

describe.for(suite)(
  'createLogServer: get /sessions/{id} ($storeType)',
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
              detail: 'Session "current" not found.',
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
        .set('content-type', mediaType)
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
              detail: 'Session "something-else" not found.',
            },
          ],
        })
        .expect('Content-Type', apiContentTypeRegExp);
    });

    it('returns a participant session', async ({ api }) => {
      await api
        .post('/sessions')
        .set('content-type', mediaType)
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
        .set('content-type', mediaType)
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

    it("includes the session's runs, experiments and last logs", async ({
      api,
      dataStore,
    }) => {
      await api
        .post('/sessions')
        .auth('host user', 'host password')
        .set('content-type', mediaType)
        .send({ data: { type: 'sessions', attributes: { role: 'host' } } })
        .expect(201);
      const { experimentId } = await dataStore.withTransaction((tx) =>
        tx.addExperiment({ experimentName: 'experiment' }),
      );
      const run = await api
        .post('/runs')
        .set('content-type', mediaType)
        .send({
          data: {
            type: 'runs',
            attributes: { name: 'run', status: 'running' },
            relationships: {
              experiment: { data: { type: 'experiments', id: experimentId } },
            },
          },
        })
        .expect(201);
      const runId = run.body.data.id;
      await dataStore.withTransaction((tx) =>
        tx.addLogs(runId, [{ type: 'test', values: {}, number: 1 }]),
      );
      const response = await api
        .get('/sessions/current')
        .query({ include: ['runs.experiment', 'runs.lastLogs'] })
        .expect(200)
        .expect('Content-Type', apiContentTypeRegExp);
      expect(
        response.body.included.map((r: { type: string }) => r.type),
      ).toEqual(['runs', 'experiments', 'logs']);
    });

    it('accepts a single include value', async ({ api }) => {
      await api
        .post('/sessions')
        .set('content-type', mediaType)
        .send({
          data: { type: 'sessions', attributes: { role: 'participant' } },
        })
        .expect(201);
      await api.get('/sessions/current').query({ include: 'runs' }).expect(200);
    });
  },
);

describe.for(suite)(
  'createLogServer: delete /sessions/{id} ($storeType)',
  ({ test: it }) => {
    it('clears the current session', async ({ api }) => {
      await api
        .post('/sessions')
        .set('content-type', mediaType)
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
        .set('content-type', mediaType)
        .send({
          data: { type: 'sessions', attributes: { role: 'participant' } },
        })
        .expect(201);
      await api.delete('/sessions/current').expect(200);
      await api.get('/sessions/current').expect(404);
      await api
        .post('/sessions')
        .auth('host user', 'host password')
        .set('content-type', mediaType)
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
        .set('content-type', mediaType)
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
