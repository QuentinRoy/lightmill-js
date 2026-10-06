import { atomicMediaType, mediaType } from '@lightmill/log-api/vocabulary';
import express from 'express';
import { describe, expect, it } from 'vitest';
import { createLogServer } from '../src/app.ts';
import {
  apiContentTypeRegExp,
  atomicContentTypeRegExp,
  authenticateAsHost,
  createClient,
  createServerContext,
  host,
  hostServerOptions,
  listen,
  storeTypes,
} from './__fixtures__/test-utils.ts';

describe.for(storeTypes)('createLogServer (%s)', (storeType) => {
  it.for([true, false, undefined])(
    'uses its own proxy trust setting, off by default (%s)',
    async (trustProxy) => {
      const { dataStore, sessionStore } = await createServerContext({
        type: storeType,
      });
      const { middleware } = createLogServer({
        dataStore,
        sessionStore,
        sessionKeys: ['secret'],
        cookieSite: 'same-site',
        secureCookies: 'always',
        ...hostServerOptions,
        trustProxy,
      });
      const app = express();
      app.set('trust proxy', !trustProxy);
      app.use(middleware);

      const response = await createClient(await listen(app))
        .post('/sessions')
        .set('Host', 'host.example.com')
        .set('X-Forwarded-Host', 'proxy.example.com')
        .set('X-Forwarded-Proto', 'https')
        .set('Content-Type', mediaType)
        .send({
          data: { type: 'sessions', attributes: { role: 'participant' } },
        })
        .expect(201);

      if (trustProxy) {
        expect(response.headers.location).toBe(
          'https://proxy.example.com/sessions/current',
        );
        expect(response.headers['set-cookie']).toEqual([
          expect.stringMatching(/; HttpOnly; Secure; SameSite=Strict$/),
        ]);
      } else {
        expect(response.headers.location).toBe(
          'http://host.example.com/sessions/current',
        );
        expect(response.headers['set-cookie']).toBeUndefined();
      }
    },
  );

  it('can be mounted on a sub path', async () => {
    let { dataStore, sessionStore } = await createServerContext({
      type: storeType,
    });
    let server = createLogServer({
      dataStore,
      sessionStore,
      sessionKeys: ['secret'],
      cookieSite: 'same-site',
      secureCookies: 'never',
      ...hostServerOptions,
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

const origin = `http://${host}`;

function getLocation(response: {
  headers: Record<string, string | undefined>;
}) {
  const location = response.headers['location'];
  if (location == null) throw new Error('Missing Location header');
  return location;
}

async function setup(
  storeType: (typeof storeTypes)[number],
  mount: string,
  { trustProxy }: { trustProxy?: boolean } = {},
) {
  let { dataStore, sessionStore } = await createServerContext({
    type: storeType,
  });
  let { middleware } = createLogServer({
    dataStore,
    sessionStore,
    sessionKeys: ['secret'],
    cookieSite: 'same-site',
    secureCookies: 'never',
    ...hostServerOptions,
    trustProxy,
  });
  let app = express();
  // Express mounts at '/' for an empty path.
  app.use(mount || '/', middleware);
  return createClient(await listen(app), { basePath: mount }).host(host);
}

describe.for(storeTypes)('createLogServer mounted (%s)', (storeType) => {
  it('does not serve its routes outside of its mount path', async () => {
    let api = await setup(storeType, '/api');
    await api
      .post('/sessions')
      .use(authenticateAsHost)
      .set('content-type', mediaType)
      .send({ data: { type: 'sessions', attributes: { role: 'host' } } })
      .expect(404, {});
  });

  it.for(['', '/api', '/a/b'])(
    'generates locations under the mount path %j',
    async (mount) => {
      let api = await setup(storeType, mount);
      const post = (path: string, body: object) =>
        api
          .post(mount + path)
          .use(authenticateAsHost)
          .set('content-type', mediaType)
          .send(body)
          .expect(201);
      // Following a location must reach the resource with the same session.
      const follow = async (location: string, expectedPath: string) => {
        expect(location).toBe(`${origin}${mount}${expectedPath}`);
        return api.get(new URL(location).pathname).expect(200);
      };

      const session = await post('/sessions', {
        data: { type: 'sessions', attributes: { role: 'host' } },
      });
      const sessionAnswer = await follow(
        getLocation(session),
        '/sessions/current',
      );
      expect(sessionAnswer.body).toEqual(session.body);

      const experiment = await post('/experiments', {
        data: { type: 'experiments', attributes: { name: 'exp' } },
      });
      const experimentId = experiment.body.data.id;
      await follow(getLocation(experiment), `/experiments/${experimentId}`);

      const run = await post('/runs', {
        data: {
          type: 'runs',
          attributes: { name: null, status: 'running' },
          relationships: {
            experiment: { data: { type: 'experiments', id: experimentId } },
          },
        },
      });
      const runId = run.body.data.id;
      await follow(getLocation(run), `/runs/${runId}`);

      const log = await post('/logs', {
        data: {
          type: 'logs',
          attributes: { number: 1, logType: 'test', values: { x: 'x' } },
          relationships: { run: { data: { type: 'runs', id: runId } } },
        },
      });
      await follow(getLocation(log), `/logs/${log.body.data.id}`);
    },
  );

  it('prepends X-Forwarded-Prefix to the mount path', async () => {
    let api = await setup(storeType, '/api', { trustProxy: true });
    const response = await api
      .post('/api/sessions')
      .use(authenticateAsHost)
      .set('content-type', mediaType)
      .set('x-forwarded-prefix', '/public/')
      .set('x-forwarded-proto', 'https')
      .send({ data: { type: 'sessions', attributes: { role: 'host' } } })
      .expect(201);
    expect(response.headers['location']).toBe(
      `https://${host}/public/api/sessions/current`,
    );
  });

  it.for(['public', '//other.example', '/public?x', '/public#x'])(
    'ignores the malformed X-Forwarded-Prefix %j',
    async (prefix) => {
      let api = await setup(storeType, '');
      const response = await api
        .post('/sessions')
        .use(authenticateAsHost)
        .set('content-type', mediaType)
        .set('x-forwarded-prefix', prefix)
        .send({ data: { type: 'sessions', attributes: { role: 'host' } } })
        .expect(201);
      expect(response.headers['location']).toBe(`${origin}/sessions/current`);
    },
  );

  it('ignores X-Forwarded-Prefix when the proxy is not trusted', async () => {
    let api = await setup(storeType, '', { trustProxy: false });
    const response = await api
      .post('/sessions')
      .use(authenticateAsHost)
      .set('content-type', mediaType)
      .set('x-forwarded-prefix', '/public')
      .send({ data: { type: 'sessions', attributes: { role: 'host' } } })
      .expect(201);
    expect(response.headers['location']).toBe(`${origin}/sessions/current`);
  });
});
