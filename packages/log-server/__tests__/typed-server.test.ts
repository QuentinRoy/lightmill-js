import express from 'express';
import request from 'supertest';
import { test } from 'vitest';
import { Store } from '../src/store.js';
import { createTypedExpressServer } from '../src/typed-server.js';

type TestApi = {
  '/resources/{id}': {
    get: {
      parameters: { query: { q: 'q' }; path: { id: 'id-1' | 'id-2' | 'id-3' } };
      responses: {
        200: { content: { 'application/json': { dataget: unknown } } };
      };
    };
    delete: {
      parameters: {
        query: { q: Array<'a' | 'b'> };
        path: { id: 'id-x' | 'id-y' };
      };
      responses: {
        200: { content: { 'application/json': { datadel: unknown } } };
      };
    };
  };
  '/resources': {
    post: {
      parameters: Record<never, never>;
      requestBody: {
        content: { 'application/json': { data: 're-post-body' } };
      };
      responses: {
        201: { content: { 'application/json': { datapost: unknown } } };
      };
    };
  };
};

test('createTypedServer', async () => {
  const mid = createTypedExpressServer<TestApi>({} as Store, {
    '/resources/{id}': {
      async get({ parameters, body }) {
        return {
          status: 200,
          body: {
            dataget: {
              path: parameters.path,
              query: parameters.query,
              body,
              handler: 'get',
            },
          },
          contentType: 'application/json',
        };
      },
      async delete({ parameters, body }) {
        return {
          status: 200,
          body: {
            datadel: {
              path: parameters.path,
              query: parameters.query,
              body,
              handler: 'delete',
            },
          },
          contentType: 'application/json',
        };
      },
    },
    '/resources': {
      async post({ parameters, body }) {
        return {
          status: 201,
          body: {
            datapost: {
              path: parameters.path,
              query: parameters.query,
              body,
              handler: 'post',
            },
          },
          contentType: 'application/json',
        };
      },
    },
  });
  const server = express();
  server.use(express.json());
  server.use(mid);

  await request(server)
    .get('/resources/id-x?q=q')
    .expect('Content-Type', /json/)
    .expect(200, {
      dataget: {
        path: { id: 'id-x' },
        query: { q: 'q' },
        body: {},
        handler: 'get',
      },
    });

  await request(server)
    .delete('/resources/id-y?q=a&q=b&q=a')
    .expect('Content-Type', /json/)
    .expect(200, {
      datadel: {
        path: { id: 'id-y' },
        query: { q: ['a', 'b', 'a'] },
        body: {},
        handler: 'delete',
      },
    });

  await request(server)
    .post('/resources/')
    .send({ data: 're-post-body' })
    .expect('Content-Type', /json/)
    .expect(201, {
      datapost: {
        path: {},
        query: {},
        body: { data: 're-post-body' },
        handler: 'post',
      },
    });
});
