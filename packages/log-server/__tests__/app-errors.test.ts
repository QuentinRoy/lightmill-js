/* eslint-disable no-empty-pattern */

import express from 'express';
import request from 'supertest';
import { afterEach, describe, test, vi } from 'vitest';
import { apiMediaType } from '../src/api.ts';
import {
  apiContentTypeRegExp,
  createAllRoute,
  createServerContext,
  storeTypes,
} from './test-utils.ts';

let allRoutes = createAllRoute();
afterEach(() => {
  allRoutes = createAllRoute();
  vi.resetAllMocks();
});

type Fixture = { api: request.Agent };

describe.for(storeTypes)('LogServer Errors (%s server)', (storeType) => {
  const it = test.extend<Fixture>({
    api: async ({}, use) => {
      let { server } = await createServerContext({ type: storeType });
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
            detail: 'Resource /not-a-route does not exist.',
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
            detail: 'Resource /resources/that-do-not-exist does not exist.',
          },
        ],
      });
  });

  it('returns a 415 error if the requested route does not accept the media type', async ({
    api,
    expect,
  }) => {
    const response = await api
      .post('/sessions')
      .set('content-type', 'application/json')
      .send({ data: { type: 'sessions', attributes: { role: 'participant' } } })
      .expect(415);
    expect(response.body).toMatchInlineSnapshot(`
      {
        "errors": [
          {
            "code": "UNSUPPORTED_MEDIA_TYPE",
            "detail": "Content type must be 'application/vnd.api+json'. Set 'Content-Type' header to 'application/vnd.api+json'.",
            "status": "Unsupported Media Type",
          },
        ],
      }
    `);
  });

  it('returns a 405 error if an unsupported method is used with an existing resource', async ({
    api,
    expect,
  }) => {
    let response1 = await api
      .put('/sessions/current')
      .set('Content-Type', apiMediaType)
      .send({})
      .expect('Content-Type', apiContentTypeRegExp)
      .expect(405)
      .expect('Allow', 'DELETE, GET');
    expect(response1.body).toMatchInlineSnapshot(`
      {
        "errors": [
          {
            "code": "METHOD_NOT_ALLOWED",
            "detail": "PUT method is not allowed for resource /sessions/{id}. Allowed methods are DELETE and GET.",
            "status": "Method Not Allowed",
          },
        ],
      }
    `);
    let response2 = await api
      .delete('/logs')
      .expect('Content-Type', apiContentTypeRegExp)
      .expect(405)
      .expect('Allow', 'GET, POST');
    expect(response2.body).toMatchInlineSnapshot(`
      {
        "errors": [
          {
            "code": "METHOD_NOT_ALLOWED",
            "detail": "DELETE method is not allowed for resource /logs. Allowed methods are GET and POST.",
            "status": "Method Not Allowed",
          },
        ],
      }
    `);
    let response3 = await api
      .put('/experiments/exp-id')
      .set('Content-Type', apiMediaType)
      .send({})
      .expect('Content-Type', apiContentTypeRegExp)
      .expect(405)
      .expect('Allow', 'GET');
    expect(response3.body).toMatchInlineSnapshot(`
      {
        "errors": [
          {
            "code": "METHOD_NOT_ALLOWED",
            "detail": "PUT method is not allowed for resource /experiments/{id}. Allowed methods are GET.",
            "status": "Method Not Allowed",
          },
        ],
      }
    `);
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
            code: 'INVALID_REQUEST_BODY',
            detail: 'Invalid input: expected object, received undefined',
            source: { pointer: '/data' },
          },
        ],
      });
    // Create a session.
    await api
      .post('/sessions')
      .set('Content-Type', apiMediaType)
      .send({ data: { type: 'sessions', attributes: { role: 'participant' } } })
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
            code: 'INVALID_REQUEST_BODY',
            detail: 'Invalid input: expected object, received string',
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
            code: 'INVALID_REQUEST_BODY',
            detail: 'Unrecognized key: "extraProp"',
            source: { pointer: '/data/attributes' },
          },
        ],
      });
  });

  it('returns a 415 error if the request content is not of the expected type', async ({
    api,
    expect,
  }) => {
    let response = await api
      .post('/sessions')
      .set('Content-Type', 'text/plain')
      .send("I'm obviously not a JSON object")
      .expect('Content-Type', apiContentTypeRegExp)
      .expect(415);
    expect(response.body).toMatchInlineSnapshot(`
      {
        "errors": [
          {
            "code": "UNSUPPORTED_MEDIA_TYPE",
            "detail": "Content type must be 'application/vnd.api+json'. Set 'Content-Type' header to 'application/vnd.api+json'.",
            "status": "Unsupported Media Type",
          },
        ],
      }
    `);
  });

  const testRoutes = it.for(allRoutes.filter((r) => r.requireAuth));
  testRoutes(
    'returns a 403 error when trying to $method $path without a session',
    async (route, { api, expect }) => {
      let response = await api[route.method](route.path).expect(403);
      expect(response.body).toMatchInlineSnapshot(`
        {
          "errors": [
            {
              "code": "SESSION_REQUIRED",
              "detail": "A session is required. Post to /sessions to create one.",
              "status": "Forbidden",
            },
          ],
        }
      `);
    },
  );

  testRoutes(
    'returns a 403 error when trying to $method $path with an invalid session key',
    async (route, { expect, api }) => {
      let response = await api[route.method](route.path)
        .set('Cookie', ['lightmill-session-id=invalid'])
        .expect('Content-Type', apiContentTypeRegExp)
        .expect(403);
      expect(response.body).toMatchInlineSnapshot(`
        {
          "errors": [
            {
              "code": "SESSION_REQUIRED",
              "detail": "A session is required. Post to /sessions to create one.",
              "status": "Forbidden",
            },
          ],
        }
      `);
    },
  );
});
