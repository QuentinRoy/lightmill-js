/* eslint-disable no-empty-pattern */

import express from 'express';
import request from 'supertest';
import { afterEach, describe, test, vi } from 'vitest';
import { apiMediaType, type ServerRequestContent } from '../src/app-utils.ts';
import {
  apiContentTypeRegExp,
  createAllRoute,
  createIntegrationTestServer,
  createUnitTestServer,
} from './test-utils.js';

let allRoutes = createAllRoute();
afterEach(() => {
  allRoutes = createAllRoute();
  vi.resetAllMocks();
});

type Fixture = { api: request.Agent };

describe.for([{ type: 'unit' }, { type: 'integration' }])(
  'LogServer Errors ($type)',
  ({ type }) => {
    const it = test.extend<Fixture>({
      api: async ({}, use) => {
        let server =
          type === 'unit'
            ? await createUnitTestServer()
            : await createIntegrationTestServer();
        let app = express().use(server.middleware);
        let api = request.agent(app);
        await use(api);
      },
    });

    it('returns a 404 error if the requested route does not exist', async ({
      api,
    }) => {
      await api
        .get('/not-a-route')
        .expect('Content-Type', apiContentTypeRegExp)
        .expect(404, {
          errors: [
            {
              status: 'Not Found',
              code: 'NOT_FOUND',
              detail: 'resource /not-a-route does not exist',
            },
          ],
        });

      await api
        .get('/resources/that-do-not-exist')
        .expect('Content-Type', apiContentTypeRegExp)
        .expect(404, {
          errors: [
            {
              status: 'Not Found',
              code: 'NOT_FOUND',
              detail: 'resource /resources/that-do-not-exist does not exist',
            },
          ],
        });
    });

    it('returns a 415 error if the requested route does not accept the media type', async ({
      api,
    }) => {
      await api
        .post('/sessions')
        .set('content-type', 'application/json')
        .send({
          data: { type: 'sessions', attributes: { role: 'participant' } },
        } satisfies ServerRequestContent<'/sessions', 'post'>['body'])
        .expect(415, {
          errors: [
            {
              status: 'Unsupported Media Type',
              code: 'UNSUPPORTED_MEDIA_TYPE',
              detail: 'unsupported media type application/json',
            },
          ],
        });
    });

    it('returns a 405 error if an unsupported method is used with an existing resource', async ({
      api,
    }) => {
      await api
        .put('/sessions/current')
        .set('Content-Type', apiMediaType)
        .send({})
        .expect('Content-Type', apiContentTypeRegExp)
        .expect(405, {
          errors: [
            {
              status: 'Method Not Allowed',
              code: 'METHOD_NOT_ALLOWED',
              detail: 'PUT method not allowed',
            },
          ],
        })
        .expect('Allow', 'DELETE, GET');
      await api
        .delete('/logs')
        .expect('Content-Type', apiContentTypeRegExp)
        .expect(405, {
          errors: [
            {
              status: 'Method Not Allowed',
              code: 'METHOD_NOT_ALLOWED',
              detail: 'DELETE method not allowed',
            },
          ],
        })
        .expect('Allow', 'POST, GET');
      await api
        .put('/experiments/exp-id')
        .set('Content-Type', apiMediaType)
        .send({})
        .expect('Content-Type', apiContentTypeRegExp)
        .expect(405, {
          errors: [
            {
              status: 'Method Not Allowed',
              code: 'METHOD_NOT_ALLOWED',
              detail: 'PUT method not allowed',
            },
          ],
        })
        .expect('Allow', 'GET');
    });

    it('returns 400 error if a request body is invalid', async ({ api }) => {
      await api
        .post('/sessions')
        .set('Content-Type', apiMediaType)
        .send({})
        .expect('Content-Type', apiContentTypeRegExp)
        .expect(400, {
          errors: [
            {
              status: 'Bad Request',
              code: 'BODY_VALIDATION',
              detail: "must have required property 'data'",
              source: { pointer: '/data' },
            },
          ],
        });
      // Create a session.
      await api
        .post('/sessions')
        .set('Content-Type', apiMediaType)
        .send({
          data: { type: 'sessions', attributes: { role: 'participant' } },
        })
        .expect(201);
      await api
        .post('/logs')
        .set('Content-Type', apiMediaType)
        .send({ data: 'invalid' })
        .expect('Content-Type', apiContentTypeRegExp)
        .expect(400, {
          errors: [
            {
              status: 'Bad Request',
              code: 'BODY_VALIDATION',
              detail: 'must be object',
              source: { pointer: '/data' },
            },
          ],
        });
      await api
        .post('/runs')
        .set('Content-Type', apiMediaType)
        .send({
          data: {
            type: 'runs',
            attributes: {
              name: 'run-name',
              status: 'running',
              extraProp: 'invalid',
            },
            relationships: {
              experiment: { data: { type: 'experiments', id: '1' } },
            },
          },
        })
        .expect('Content-Type', apiContentTypeRegExp)
        .expect(400, {
          errors: [
            {
              status: 'Bad Request',
              code: 'BODY_VALIDATION',
              detail: 'must NOT be valid',
              source: { pointer: '/data/attributes/extraProp' },
            },
          ],
        });
    });

    it('returns a 415 error if the request content is not of the expected type', async ({
      api,
    }) => {
      await api
        .post('/sessions')
        .set('Content-Type', 'text/plain')
        .send("I'm obviously not a JSON object")
        .expect('Content-Type', apiContentTypeRegExp)
        .expect(415, {
          errors: [
            {
              status: 'Unsupported Media Type',
              code: 'UNSUPPORTED_MEDIA_TYPE',
              detail: 'unsupported media type text/plain',
            },
          ],
        });
    });

    const testRoutes = it.for(allRoutes.filter((r) => r.requireAuth));
    testRoutes(
      'returns a 403 error when trying to $method $path without a session',
      async (route, { api }) => {
        await api[route.method](route.path).expect(403, {
          errors: [
            {
              status: 'Forbidden',
              code: 'SESSION_REQUIRED',
              detail: 'session required, post to /sessions',
            },
          ],
        });
      },
    );

    testRoutes(
      'returns a 403 error when trying to $method $path with an invalid session key',
      async (route, { api }) => {
        await api[route.method](route.path)
          .set('Cookie', ['lightmill-session-id=invalid'])
          .expect('Content-Type', apiContentTypeRegExp)
          .expect(403, {
            errors: [
              {
                status: 'Forbidden',
                code: 'SESSION_REQUIRED',
                detail: 'session required, post to /sessions',
              },
            ],
          });
      },
    );
  },
);
