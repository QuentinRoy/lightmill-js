import { atomicMediaType, mediaType } from '@lightmill/log-api/vocabulary';
import express from 'express';
import { describe, it } from 'vitest';
import { createLogServer } from '../src/app.ts';
import {
  apiContentTypeRegExp,
  atomicContentTypeRegExp,
  createClient,
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
      dataStore,
      sessionStore,
      sessionKeys: ['secret'],
      allowCrossOrigin: false,
      secureCookies: false,
    });
    let app = express();
    app.set('query parser', false);
    app.use('/api', server.middleware);
    let api = createClient(await listen(app), { basePath: '/api' }).host(
      'lightmill-test.com',
    );

    await api
      .post('/api/sessions')
      .set('content-type', mediaType)
      .send({ data: { type: 'sessions', attributes: { role: 'participant' } } })
      .expect('Content-Type', apiContentTypeRegExp)
      .expect(201, {
        data: {
          id: 'current',
          type: 'sessions',
          attributes: { role: 'participant' },
          relationships: { runs: { data: [] } },
        },
      });

    await api.get('/api/runs').expect(200, { data: [] });

    await api
      .get('/api/experiments?filter[name]=%E0%A4%A')
      .expect('Content-Type', apiContentTypeRegExp)
      .expect(400, {
        errors: [
          {
            status: 'Bad Request',
            code: 'INVALID_REQUEST_QUERY',
            detail:
              'Query parameter "filter[name]" has malformed percent-encoding.',
            source: { parameter: 'filter[name]' },
          },
        ],
      });

    await api
      .get('/api/sessions/%E0%A4%A')
      .expect('Content-Type', apiContentTypeRegExp)
      .expect(404, {
        errors: [
          {
            status: 'Not Found',
            code: 'NOT_FOUND',
            detail: 'Resource /api/sessions/%E0%A4%A does not exist.',
          },
        ],
      });

    await api
      .post('/api/operations')
      .set('Content-Type', atomicMediaType)
      .send('{"atomic:operations": ')
      .expect('Content-Type', atomicContentTypeRegExp)
      .expect(400);
  });
});
