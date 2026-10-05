/* eslint-disable no-empty-pattern */

import { atomicMediaType, mediaType } from '@lightmill/log-api/vocabulary';
import express from 'express';
import { MemoryStore } from 'express-session';
import request from 'supertest';
import { afterEach, describe, test, vi } from 'vitest';
import { DataStoreError } from '../src/data-store-errors.ts';
import {
  apiContentTypeRegExp,
  atomicContentTypeRegExp,
  createAllRoute,
  createServerContext,
  listen,
  storeTypes,
  type MockedDataStore,
} from './__fixtures__/test-utils.ts';

let allRoutes = createAllRoute();
afterEach(() => {
  allRoutes = createAllRoute();
  vi.resetAllMocks();
});

type Fixture = { api: request.Agent };

// Each route answers body errors with its own media type, however the path is
// spelled.
const bodyErrorRoutes = [
  ['/logs', mediaType, apiContentTypeRegExp],
  ['/operations', atomicMediaType, atomicContentTypeRegExp],
  ['/operations/', atomicMediaType, atomicContentTypeRegExp],
  ['/OPERATIONS', atomicMediaType, atomicContentTypeRegExp],
] as const;

describe.for(storeTypes)('createLogServer Errors (%s server)', (storeType) => {
  const it = test.extend<Fixture>({
    api: async ({}, use) => {
      let { server } = await createServerContext({ type: storeType });
      let app = express().use(server.middleware);
      let api = request.agent(await listen(app));
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

  it('returns a client error for a path parameter that cannot be decoded', async ({
    api,
    expect,
  }) => {
    const response = await api
      .get('/sessions/%E0%A4%A')
      .expect('Content-Type', apiContentTypeRegExp);
    // Only the class: the current `400 INVALID_REQUEST_BODY` names a body for
    // a path problem, and is not a contract to keep.
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
  });

  it('returns a 404 error for a route that does not exist whatever its body', async ({
    api,
  }) => {
    await api
      .post('/not-a-route')
      .set('Content-Type', mediaType)
      .send('{"data": ')
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

  it('returns a 415 error for an unaccepted media type whatever the body', async ({
    api,
  }) => {
    await api
      .post('/sessions')
      .set('content-type', 'application/json')
      .send('{"data": ')
      .expect('Content-Type', apiContentTypeRegExp)
      .expect(415);
  });

  it('returns a 415 error for a body without a media type', async ({ api }) => {
    await api
      .post('/sessions')
      // A Buffer is sent as is, without a Content-Type header.
      .send(Buffer.from('{"data": ', 'utf8'))
      .expect('Content-Type', apiContentTypeRegExp)
      .expect(415);
  });

  it('returns a 415 error for a chunked body without a media type', async ({
    api,
  }) => {
    const request = api.post('/sessions');
    // Writing before ending sends the body in chunks, without a length.
    request.write('{"data": ');
    await request.expect('Content-Type', apiContentTypeRegExp).expect(415);
  });

  it('accepts an empty body without a media type', async ({ api }) => {
    await api
      .post('/sessions')
      .set('Content-Type', mediaType)
      .send({ data: { type: 'sessions', attributes: { role: 'participant' } } })
      .expect(201);
    await api
      .delete('/sessions/current')
      .set('Content-Length', '0')
      .expect(200, { data: null });
  });

  it('returns a 400 error if a route without a body receives one', async ({
    api,
    expect,
  }) => {
    await api
      .post('/sessions')
      .set('Content-Type', mediaType)
      .send({ data: { type: 'sessions', attributes: { role: 'participant' } } })
      .expect(201);
    const response = await api
      .get('/experiments')
      .set('Content-Type', mediaType)
      .send({ data: {} })
      .expect('Content-Type', apiContentTypeRegExp)
      .expect(400);
    expect(response.body).toEqual({
      errors: [
        {
          status: 'Bad Request',
          code: 'INVALID_REQUEST_BODY',
          detail: expect.any(String),
          source: { pointer: '' },
        },
      ],
    });
  });

  it('answers a 415 on /operations with the atomic media type', async ({
    api,
  }) => {
    await api
      .post('/operations')
      .set('Content-Type', mediaType)
      .send({ 'atomic:operations': [] })
      .expect('Content-Type', atomicContentTypeRegExp)
      .expect(415);
  });

  it('answers a 405 on /operations with the atomic media type', async ({
    api,
  }) => {
    await api
      .get('/operations')
      .expect('Content-Type', atomicContentTypeRegExp)
      .expect('Allow', 'POST')
      .expect(405);
  });

  it.for(bodyErrorRoutes)(
    'returns a 413 error if the body of a request to %s is over 1 MB',
    async ([path, contentType, contentTypeRegExp], { api, expect }) => {
      const response = await api
        .post(path)
        .set('Content-Type', contentType)
        // The JSON around the padding puts the body over 1 MB.
        .send(JSON.stringify({ padding: 'x'.repeat(1024 * 1024) }))
        .expect('Content-Type', contentTypeRegExp)
        .expect(413);
      expect(response.body).toEqual({
        errors: [
          {
            status: 'Payload Too Large',
            code: 'REQUEST_BODY_TOO_LARGE',
            detail: expect.any(String),
          },
        ],
      });
    },
  );

  it.for(bodyErrorRoutes)(
    'returns a 400 error if the body of a request to %s is not valid JSON',
    async ([path, contentType, contentTypeRegExp], { api, expect }) => {
      const response = await api
        .post(path)
        .set('Content-Type', contentType)
        .send('{"data": ')
        .expect('Content-Type', contentTypeRegExp)
        .expect(400);
      expect(response.body).toEqual({
        errors: [
          {
            status: 'Bad Request',
            code: 'INVALID_REQUEST_BODY',
            detail: expect.any(String),
          },
        ],
      });
    },
  );

  it('returns a 415 error if the body of a request has an encoding the server cannot decode', async ({
    api,
    expect,
  }) => {
    const response = await api
      .post('/logs')
      .set('Content-Type', mediaType)
      .set('Content-Encoding', 'not-an-encoding')
      .send('{}')
      .expect('Content-Type', apiContentTypeRegExp)
      .expect(415);
    expect(response.body).toEqual({
      errors: [
        {
          status: 'Unsupported Media Type',
          code: 'UNSUPPORTED_MEDIA_TYPE',
          detail: expect.any(String),
        },
      ],
    });
  });

  it('returns a 405 error if an unsupported method is used with an existing resource', async ({
    api,
    expect,
  }) => {
    let response1 = await api
      .put('/sessions/current')
      .set('Content-Type', mediaType)
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
      .set('Content-Type', mediaType)
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

  it('returns a 405 error for an unsupported method whatever its body', async ({
    api,
  }) => {
    await api
      .put('/sessions/current')
      .set('Content-Type', mediaType)
      .send('{"data": ')
      .expect('Content-Type', apiContentTypeRegExp)
      .expect('Allow', 'DELETE, GET')
      .expect(405);
  });

  it('returns 400 error if a request body is invalid', async ({ api }) => {
    await api
      .post('/sessions')
      .set('Content-Type', mediaType)
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
      .set('Content-Type', mediaType)
      .send({ data: { type: 'sessions', attributes: { role: 'participant' } } })
      .expect(201);
    await api
      .post('/logs')
      .set('Content-Type', mediaType)
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
      .set('Content-Type', mediaType)
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

  it('points to the whole document if the request body itself is invalid', async ({
    api,
  }) => {
    await api
      .post('/sessions')
      .set('Content-Type', mediaType)
      .send([])
      .expect('Content-Type', apiContentTypeRegExp)
      .expect(400, {
        errors: [
          {
            status: 'Bad Request',
            code: 'INVALID_REQUEST_BODY',
            detail: 'Invalid input: expected object, received array',
            source: { pointer: '' },
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
        .expect(
          'Content-Type',
          route.path === '/operations'
            ? atomicContentTypeRegExp
            : apiContentTypeRegExp,
        )
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

describe.for(storeTypes)(
  'createLogServer: busy store (%s server)',
  (storeType) => {
    const it = test.extend<{ api: request.Agent; dataStore: MockedDataStore }>({
      dataStore: async ({}, use) => {
        const { dataStore } = await createServerContext({ type: storeType });
        await use(dataStore);
      },
      api: async ({ dataStore }, use) => {
        const { server } = await createServerContext({
          dataStore,
          sessionStore: new MemoryStore(),
        });
        const api = request.agent(
          await listen(express().use(server.middleware)),
        );
        await api
          .post('/sessions')
          .set('Content-Type', mediaType)
          .send({ data: { type: 'sessions', attributes: { role: 'host' } } })
          .expect(201);
        await use(api);
      },
    });
    const conflict = () =>
      new DataStoreError(
        'The transaction conflicted with another one.',
        DataStoreError.TRANSACTION_CONFLICT,
      );
    const serviceUnavailable = {
      errors: [
        {
          status: 'Service Unavailable',
          code: 'SERVICE_UNAVAILABLE',
          detail:
            'The server could not process the request right now, and nothing was saved. Try again.',
        },
      ],
    };

    it('answers 503 with Retry-After when a transaction conflicts', async ({
      api,
      dataStore,
    }) => {
      dataStore.withTransaction.mockRejectedValueOnce(conflict());
      await api
        .post('/runs')
        .set('Content-Type', mediaType)
        .send({
          data: {
            type: 'runs',
            attributes: { name: null, status: 'idle' },
            relationships: {
              experiment: { data: { type: 'experiments', id: '1' } },
            },
          },
        })
        .expect('Content-Type', apiContentTypeRegExp)
        .expect('Retry-After', '1')
        .expect(503, serviceUnavailable);
    });

    it('answers 503 when a read conflicts', async ({ api, dataStore }) => {
      dataStore.getRuns.mockRejectedValueOnce(conflict());
      await api
        .get('/runs')
        .expect('Retry-After', '1')
        .expect(503, serviceUnavailable);
    });

    it('answers 500 when a handler throws an error with a client status', async ({
      api,
      dataStore,
    }) => {
      dataStore.getRuns.mockRejectedValueOnce(
        Object.assign(new Error('boom'), { status: 400 }),
      );
      await api
        .get('/runs')
        .expect(500, {
          errors: [
            {
              status: 'Internal Server Error',
              code: 'INTERNAL_SERVER_ERROR',
              detail: 'boom',
            },
          ],
        });
    });

    it('keeps the atomic operations media type', async ({ api, dataStore }) => {
      const { experimentId } = await dataStore.withTransaction((tx) =>
        tx.addExperiment({ experimentName: 'experiment' }),
      );
      const run = await api
        .post('/runs')
        .set('Content-Type', mediaType)
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
      dataStore.withTransaction.mockRejectedValueOnce(conflict());
      await api
        .post('/operations')
        .set('Content-Type', atomicMediaType)
        .send({
          'atomic:operations': [
            {
              op: 'add',
              data: {
                type: 'logs',
                attributes: { number: 1, logType: 'test', values: {} },
                relationships: {
                  run: { data: { type: 'runs', id: run.body.data.id } },
                },
              },
            },
          ],
        })
        .expect('Content-Type', atomicContentTypeRegExp)
        .expect('Retry-After', '1')
        .expect(503, serviceUnavailable);
    });

    it('keeps the atomic operations media type on a 500', async ({
      api,
      dataStore,
    }) => {
      const { experimentId } = await dataStore.withTransaction((tx) =>
        tx.addExperiment({ experimentName: 'experiment' }),
      );
      const run = await api
        .post('/runs')
        .set('Content-Type', mediaType)
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
      dataStore.withTransaction.mockRejectedValueOnce(new Error('boom'));
      await api
        .post('/operations')
        .set('Content-Type', atomicMediaType)
        .send({
          'atomic:operations': [
            {
              op: 'add',
              data: {
                type: 'logs',
                attributes: { number: 1, logType: 'test', values: {} },
                relationships: {
                  run: { data: { type: 'runs', id: run.body.data.id } },
                },
              },
            },
          ],
        })
        .expect('Content-Type', atomicContentTypeRegExp)
        .expect(500, {
          errors: [
            {
              status: 'Internal Server Error',
              code: 'INTERNAL_SERVER_ERROR',
              detail: 'boom',
            },
          ],
        });
    });
  },
);
