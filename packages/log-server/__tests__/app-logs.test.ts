import type { Store as SessionStore } from 'express-session';
import request from 'supertest';
import { beforeEach, describe, expect } from 'vitest';
import { apiMediaType, atomicMediaType } from '../src/api.ts';
import { DataStoreError } from '../src/data-store-errors.ts';
import type { DataStore, ExperimentId, RunId } from '../src/data-store.ts';
import {
  apiContentTypeRegExp,
  createSessionTest,
  storeTypes,
  type StoreType,
  type WithMockedMethods,
} from './test-utils.ts';

type TestContext = {
  runId: RunId;
  experimentId: ExperimentId;
  dataStore: WithMockedMethods<DataStore>;
  sessionStore: WithMockedMethods<SessionStore>;
  participantApi: request.Agent;
  hostApi: request.Agent;
};

function createTest(storeType: StoreType) {
  return createSessionTest({
    storeType,
    sessionType: 'host',
  }).extend<TestContext>({
    experimentId: async ({ hostApi }, use) => {
      const response = await hostApi
        .post('/experiments')
        .set('Content-Type', apiMediaType)
        .send({
          data: {
            type: 'experiments',
            attributes: { name: 'test-experiment' },
          },
        })
        .expect(201);
      expect(response.body.data.id).toBeDefined();
      use(response.body.data.id);
    },

    runId: async ({ experimentId, participantApi }, use) => {
      const response = await participantApi
        .post('/runs')
        .set('Content-Type', apiMediaType)
        .send({
          data: {
            type: 'runs',
            attributes: { name: 'test-run', status: 'running' },
            relationships: {
              experiment: { data: { type: 'experiments', id: experimentId } },
            },
          },
        })
        .expect(201);
      expect(response.body.data.id).toBeDefined();
      use(response.body.data.id);
    },

    dataStore: async ({ session: { dataStore } }, use) => {
      use(dataStore);
    },

    sessionStore: async ({ session: { sessionStore } }, use) => {
      use(sessionStore);
    },

    participantApi: async ({ session }, use) => {
      const { app } = session;
      const api = request.agent(app).host('lightmill-test.com');
      await api
        .post('/sessions')
        .set('Content-Type', apiMediaType)
        .send({
          data: { type: 'sessions', attributes: { role: 'participant' } },
        })
        .expect(201);
      use(api);
    },

    hostApi: async ({ session }, use) => {
      const { app } = session;
      const api = request.agent(app).host('lightmill-test.com');
      await api
        .post('/sessions')
        .set('Content-Type', apiMediaType)
        .send({ data: { type: 'sessions', attributes: { role: 'host' } } })
        .expect(201);
      use(api);
    },
  });
}

describe.each(storeTypes)('LogServer: post /logs (%s)', (storeType) => {
  const it = createTest(storeType);
  it.for(['host', 'participant'] as const)(
    'adds a log (%s user)',
    async (userType, { expect, participantApi, runId, dataStore }) => {
      const api = userType === 'host' ? participantApi : participantApi;
      const response = await api
        .post('/logs')
        .set('Content-Type', apiMediaType)
        .send({
          data: {
            type: 'logs',
            attributes: { number: 1, logType: 'test', values: { x: 'x' } },
            relationships: { run: { data: { type: 'runs', id: runId } } },
          },
        })
        .expect(201)
        .expect('Content-Type', apiContentTypeRegExp);

      expect(response.body).toEqual({
        data: { type: 'logs', id: expect.any(String) },
      });
      expect(dataStore.addLogs).toHaveBeenCalledWith(runId, [
        { type: 'test', values: { x: 'x' }, number: 1 },
      ]);
      expect(response.headers.location).toBe(
        `http://lightmill-test.com/logs/${response.body.data.id}`,
      );
    },
  );

  it('answers 200 to a resent log and refuses a conflicting one', async ({
    expect,
    participantApi,
    runId,
  }) => {
    const post = (values: object) =>
      participantApi
        .post('/logs')
        .set('Content-Type', apiMediaType)
        .send({
          data: {
            type: 'logs',
            attributes: { number: 1, logType: 'test', values },
            relationships: { run: { data: { type: 'runs', id: runId } } },
          },
        });
    const first = await post({ x: 1, y: 2 }).expect(201);
    // Nothing is created for a resend.
    const resent = await post({ y: 2, x: 1 }).expect(200);
    expect(resent.body).toEqual(first.body);
    expect(resent.headers.location).toBe(first.headers.location);
    await post({ x: 2 }).expect(409);
  });

  it('refuses to add logs if client does not have access to the run', async ({
    expect,
    participantApi,
    hostApi,
    experimentId,
    dataStore,
  }) => {
    const response = await hostApi
      .post('/runs')
      .set('Content-Type', apiMediaType)
      .send({
        data: {
          type: 'runs',
          attributes: { name: 'my-run', status: 'running' },
          relationships: {
            experiment: { data: { type: 'experiments', id: experimentId } },
          },
        },
      })
      .expect(201);
    expect(response.body.data.id).toBeDefined();
    await participantApi
      .post('/logs')
      .set('Content-Type', apiMediaType)
      .send({
        data: {
          type: 'logs',
          attributes: { number: 1, logType: 'test', values: { x: 'x' } },
          relationships: {
            run: { data: { type: 'runs', id: response.body.data.id } },
          },
        },
      })
      .expect(403, {
        errors: [
          {
            status: 'Forbidden',
            code: 'RUN_NOT_FOUND',
            detail: `Run "${response.body.data.id}" not found`,
          },
        ],
      })
      .expect('Content-Type', apiContentTypeRegExp);
    expect(dataStore.addLogs).not.toHaveBeenCalled();
  });

  it('allows hosts to add logs to any run', async ({
    expect,
    runId,
    hostApi,
  }) => {
    const sessionResponse = await hostApi.get('/sessions/current').expect(200);
    // Sanity check to ensure this run is not part of the host session.
    expect(sessionResponse.body.data.attributes.runs ?? []).not.toContain(
      runId,
    );
    await hostApi
      .post('/logs')
      .set('Content-Type', apiMediaType)
      .send({
        data: {
          type: 'logs',
          attributes: { number: 1, logType: 'test', values: { x: 'x' } },
          relationships: { run: { data: { type: 'runs', id: runId } } },
        },
      })
      .expect(201);
  });

  it.for(['host', 'participant'] as const)(
    'refuses to add logs to a run that does not exist (%s user)',
    async (userType, { expect, dataStore, participantApi, hostApi }) => {
      const api = userType === 'host' ? hostApi : participantApi;
      await api
        .post('/logs')
        .set('Content-Type', apiMediaType)
        .send({
          data: {
            type: 'logs',
            attributes: { number: 1, logType: 'test', values: { x: 'x' } },
            relationships: {
              run: { data: { type: 'runs', id: 'does-not-exist' } },
            },
          },
        })
        .expect(403, {
          errors: [
            {
              status: 'Forbidden',
              code: 'RUN_NOT_FOUND',
              detail: 'Run "does-not-exist" not found',
            },
          ],
        })
        .expect('Content-Type', apiContentTypeRegExp);
      expect(dataStore.addLogs).not.toHaveBeenCalled();
    },
  );

  it.for(['host', 'participant'] as const)(
    'refuses to add logs if their number is already in used (%s user)',
    async (userType, { participantApi, hostApi, dataStore, runId }) => {
      const api = userType === 'host' ? hostApi : participantApi;
      dataStore.addLogs.mockImplementation(async () => {
        throw new DataStoreError(
          'Error message that should not be seen by the user',
          DataStoreError.LOG_NUMBER_EXISTS_IN_SEQUENCE,
          { logNumber: 2 },
        );
      });
      await api
        .post('/logs')
        .set('Content-Type', apiMediaType)
        .send({
          data: {
            type: 'logs',
            attributes: { number: 2, logType: 'test-log', values: {} },
            relationships: { run: { data: { type: 'runs', id: runId } } },
          },
        })
        .expect(409, {
          errors: [
            {
              status: 'Conflict',
              code: 'LOG_NUMBER_EXISTS',
              detail:
                `Cannot add log to run '1', log number 2 already exists with a different type or values.` +
                ` Ensure the log number is unique within the run.`,
            },
          ],
        })
        .expect('Content-Type', apiContentTypeRegExp);
    },
  );
});

describe.each(storeTypes)('LogServer: post /operations (%s)', (storeType) => {
  const it = createTest(storeType);
  const atomicContentTypeRegExp =
    /^application\/vnd\.api\+json(;\s*charset=[^\s;]+)?;\s*ext="https:\/\/jsonapi\.org\/ext\/atomic"/;
  const add = (
    runId: string,
    number: number,
    values: object = { n: number },
  ) => ({
    op: 'add',
    data: {
      type: 'logs',
      attributes: { number, logType: 'test', values },
      relationships: { run: { data: { type: 'runs', id: runId } } },
    },
  });
  const post = (api: request.Agent, operations: object[]) =>
    api
      .post('/operations')
      .set('Content-Type', atomicMediaType)
      .send({ 'atomic:operations': operations });

  it('adds logs and answers their ids in order', async ({
    expect,
    participantApi,
    runId,
    dataStore,
  }) => {
    const response = await post(participantApi, [add(runId, 2), add(runId, 1)])
      .expect(200)
      .expect('Content-Type', atomicContentTypeRegExp);
    expect(response.body).toEqual({
      'atomic:results': [
        { data: { type: 'logs', id: expect.any(String) } },
        { data: { type: 'logs', id: expect.any(String) } },
      ],
    });
    expect(dataStore.addLogs).toHaveBeenCalledTimes(1);
    const [second, first] = response.body['atomic:results'];
    const logs = await participantApi
      .get('/logs')
      .set('Accept', apiMediaType)
      .expect(200);
    const numberOf = (id: string) =>
      logs.body.data.find((l: { id: string }) => l.id === id).attributes.number;
    expect([numberOf(second.data.id), numberOf(first.data.id)]).toEqual([2, 1]);
  });

  it('accepts a body of several hundred kilobytes', async ({
    expect,
    participantApi,
    runId,
  }) => {
    const padding = 'x'.repeat(600 * 1024);
    const response = await post(participantApi, [
      add(runId, 1, { padding }),
    ]).expect(200);
    expect(response.body['atomic:results']).toHaveLength(1);
  });

  it('answers the stored ids to a resent batch, and stores what is new', async ({
    expect,
    participantApi,
    runId,
  }) => {
    const first = await post(participantApi, [
      add(runId, 1),
      add(runId, 2),
    ]).expect(200);
    const resent = await post(participantApi, [
      add(runId, 2),
      add(runId, 1),
      add(runId, 3),
    ]).expect(200);
    const [id1, id2] = first.body['atomic:results'];
    expect(resent.body['atomic:results'].slice(0, 2)).toEqual([id2, id1]);
  });

  it('stores nothing if one log conflicts with a stored one', async ({
    expect,
    participantApi,
    runId,
  }) => {
    await post(participantApi, [add(runId, 1)]).expect(200);
    const response = await post(participantApi, [
      add(runId, 2),
      add(runId, 1, { other: 1 }),
    ])
      .expect(409)
      .expect('Content-Type', atomicContentTypeRegExp);
    expect(response.body).toEqual({
      errors: [
        {
          status: 'Conflict',
          code: 'LOG_NUMBER_EXISTS',
          detail: expect.any(String),
          source: { pointer: '/atomic:operations/1/data/attributes/number' },
        },
      ],
    });
    // Number 2 was not stored by the failed batch, so it is still free.
    await post(participantApi, [add(runId, 2, { other: 2 })]).expect(200);
  });

  it('points at the first conflicting log', async ({
    expect,
    participantApi,
    runId,
  }) => {
    await post(participantApi, [add(runId, 1), add(runId, 2)]).expect(200);
    const response = await post(participantApi, [
      add(runId, 3),
      add(runId, 2, { other: 2 }),
      add(runId, 1, { other: 1 }),
    ]).expect(409);
    expect(response.body.errors[0].source.pointer).toBe(
      '/atomic:operations/1/data/attributes/number',
    );
  });

  it('refuses a number repeated within the batch', async ({
    expect,
    participantApi,
    runId,
  }) => {
    const response = await post(participantApi, [add(runId, 1), add(runId, 1)])
      .expect(400)
      .expect('Content-Type', atomicContentTypeRegExp);
    expect(response.body).toEqual({
      errors: [
        {
          status: 'Bad Request',
          code: 'INVALID_REQUEST_BODY',
          detail: expect.any(String),
          source: { pointer: '/atomic:operations/1/data/attributes/number' },
        },
      ],
    });
  });

  it('refuses logs of several runs', async ({
    expect,
    participantApi,
    runId,
  }) => {
    const response = await post(participantApi, [
      add(runId, 1),
      add('other-run', 2),
    ])
      .expect(400)
      .expect('Content-Type', atomicContentTypeRegExp);
    expect(response.body).toEqual({
      errors: [
        {
          status: 'Bad Request',
          code: 'INVALID_REQUEST_BODY',
          detail: expect.any(String),
          source: {
            pointer: '/atomic:operations/1/data/relationships/run/data/id',
          },
        },
      ],
    });
  });

  it('refuses operations other than adding logs', async ({
    expect,
    participantApi,
    runId,
  }) => {
    const response = await post(participantApi, [
      { ...add(runId, 1), op: 'remove' },
    ])
      .expect(400)
      .expect('Content-Type', atomicContentTypeRegExp);
    expect(response.body.errors[0]).toMatchObject({
      code: 'INVALID_REQUEST_BODY',
      source: { pointer: '/atomic:operations/0/op' },
    });
    await post(participantApi, []).expect(400);
  });

  it('refuses logs for a run that is not running', async ({
    expect,
    participantApi,
    runId,
    dataStore,
  }) => {
    await participantApi
      .patch(`/runs/${runId}`)
      .set('Content-Type', apiMediaType)
      .send({
        data: { id: runId, type: 'runs', attributes: { status: 'completed' } },
      })
      .expect(200);
    dataStore.addLogs.mockClear();
    const response = await post(participantApi, [add(runId, 1)])
      .expect(403)
      .expect('Content-Type', atomicContentTypeRegExp);
    expect(response.body.errors[0]).toMatchObject({
      code: 'INVALID_RUN_STATUS',
    });
    expect(dataStore.addLogs).not.toHaveBeenCalled();
  });

  it('refuses to add a resource that is not a log', async ({
    expect,
    participantApi,
    runId,
  }) => {
    const operation = add(runId, 1);
    const response = await post(participantApi, [
      { ...operation, data: { ...operation.data, type: 'runs' } },
    ])
      .expect(400)
      .expect('Content-Type', atomicContentTypeRegExp);
    expect(response.body.errors[0]).toMatchObject({
      code: 'INVALID_REQUEST_BODY',
      source: { pointer: '/atomic:operations/0/data/type' },
    });
  });

  it('refuses a run the client has no access to', async ({
    expect,
    participantApi,
    dataStore,
  }) => {
    const response = await post(participantApi, [add('does-not-exist', 1)])
      .expect(403)
      .expect('Content-Type', atomicContentTypeRegExp);
    expect(response.body).toEqual({
      errors: [
        {
          status: 'Forbidden',
          code: 'RUN_NOT_FOUND',
          detail: 'Run "does-not-exist" not found',
        },
      ],
    });
    expect(dataStore.addLogs).not.toHaveBeenCalled();
  });

  it.for([
    'Application/Vnd.Api+JSON; EXT="https://jsonapi.org/ext/atomic"',
    `${atomicMediaType}; profile="https://example.com/profile"`,
  ])(
    'accepts the content type %s',
    async (contentType, { participantApi, runId }) => {
      await participantApi
        .post('/operations')
        .set('Content-Type', contentType)
        .send({ 'atomic:operations': [add(runId, 1)] })
        .expect(200);
    },
  );

  it.for([
    'application/vnd.api+json; ext="https://JSONAPI.org/ext/atomic"',
    `${atomicMediaType}; charset=utf-8`,
    'application/vnd.api+json; ext=https://jsonapi.org/ext/atomic',
    'application/vnd.api+json; ext="https://jsonapi.org/ext/atomic https://example.com/ext"',
  ])(
    'refuses the content type %s',
    async (contentType, { participantApi, runId }) => {
      await participantApi
        .post('/operations')
        .set('Content-Type', contentType)
        .send({ 'atomic:operations': [add(runId, 1)] })
        .expect(415);
    },
  );

  it('refuses an unknown extension', async ({ participantApi, runId }) => {
    await participantApi
      .post('/operations')
      .set('Content-Type', `${apiMediaType};ext="https://example.com/ext"`)
      .send({ 'atomic:operations': [add(runId, 1)] })
      .expect(415);
  });

  it('requires the atomic operations media type', async ({
    participantApi,
    runId,
  }) => {
    const body = { 'atomic:operations': [add(runId, 1)] };
    await participantApi
      .post('/operations')
      .set('Content-Type', apiMediaType)
      .send(body)
      .expect(415);
    await participantApi
      .post('/logs')
      .set('Content-Type', atomicMediaType)
      .send(add(runId, 1))
      .expect(415);
  });
});

describe.each(storeTypes)('LogServer: get /logs (%s)', (storeType) => {
  const it = createTest(storeType);

  beforeEach<TestContext>(
    async ({ dataStore: dataStore, runId, experimentId }) => {
      await dataStore.addLogs(runId, [
        { type: 'log-type', values: { x: 'x1', y: 'y1' }, number: 1 },
        { type: 'log-type', values: { y: 'y2', x: 'x2' }, number: 2 },
        { type: 'log-type', values: { y: 'y3', x: 'x3' }, number: 3 },
      ]);
      let newRun = await dataStore.addRun({
        runName: 'other-run',
        experimentId,
        runStatus: 'running',
      });
      await dataStore.addLogs(newRun.runId, [
        { type: 'log-type', values: { x: 'x4', y: 'y4' }, number: 1 },
        { type: 'log-type', values: { y: 'y5', x: 'x5' }, number: 2 },
      ]);
    },
  );

  it('returns logs as csv by default', async ({ expect, hostApi }) => {
    let result = await hostApi
      .get('/logs')
      .expect(200)
      .expect('Content-Type', /^text\/csv/);
    expect(result.text).toMatchSnapshot();
  });

  it('returns logs as json if json is the first supported format in the Accept header', async ({
    expect,
    hostApi,
  }) => {
    let result = await hostApi
      .get('/logs')
      .set('Accept', apiMediaType)
      .expect(200)
      .expect('Content-Type', apiContentTypeRegExp);
    expect(result.body).toMatchSnapshot();
  });

  it('returns logs as csv if csv is the first supported format in the Accept header', async ({
    expect,
    hostApi,
  }) => {
    let result = await hostApi
      .get('/logs')
      .set('Accept', 'text/csv')
      .expect(200);
    expect(result.text).toMatchSnapshot();
  });

  it('respects the q weighting factor', async ({ expect, hostApi }) => {
    let result = await hostApi
      .get('/logs')
      .set('Accept', `text/csv;q=0.1,${apiMediaType};q=0.9`)
      .expect(200)
      .expect('Content-Type', apiContentTypeRegExp);
    expect(result.text).toMatchSnapshot();
  });

  it('returns logs as csv if no format specified in accept header is supported', async ({
    expect,
    hostApi,
  }) => {
    let result = await hostApi
      .get('/logs')
      .set(
        'Accept',
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
      )
      .expect(200)
      .expect('Content-Type', /^text\/csv/);
    expect(result.text).toMatchSnapshot();
  });

  it('returns only logs a participant has access to', async ({
    expect,
    dataStore,
    experimentId,
    participantApi,
  }) => {
    dataStore.addRun({ runName: 'other-run', experimentId });
    dataStore.addLogs('other-run', [
      { type: 'log-type', values: { x: 'x4', y: 'y4' }, number: 1 },
      { type: 'log-type', values: { y: 'y5', x: 'x5' }, number: 2 },
    ]);

    let result = await participantApi
      .set('Accept', apiMediaType)
      .get('/logs')
      .expect(200)
      .expect('Content-Type', apiContentTypeRegExp);
    expect(result.body).toMatchSnapshot();
  });

  // TODO: we should also test for multiple run names, experiment names, and
  // types.
  const testWithFormat = it
    .extend<{
      context: {
        testRunId: RunId;
        testExperimentId: ExperimentId;
        testRunName: string;
        testExperimentName: string;
      };
    }>({
      context: [
        async ({ dataStore, experimentId: otherExperimentId }, use) => {
          const testRunName = 'log-test-run';
          const testExperimentName = 'log-test-experiment';
          const { experimentId: testExperimentId } =
            await dataStore.addExperiment({
              experimentName: testExperimentName,
            });
          const { runId: testRunId } = await dataStore.addRun({
            runName: testRunName,
            experimentId: testExperimentId,
            runStatus: 'running',
          });
          const { runId: r1 } = await dataStore.addRun({
            runName: 'other-run-1',
            experimentId: testExperimentId,
            runStatus: 'running',
          });
          const { runId: r2 } = await dataStore.addRun({
            runName: testRunName,
            experimentId: otherExperimentId,
            runStatus: 'running',
          });
          const { runId: r3 } = await dataStore.addRun({
            runName: 'other-run-2',
            experimentId: otherExperimentId,
            runStatus: 'running',
          });
          let v = 1;
          await dataStore.addLogs(testRunId, [
            { type: 'log-type', values: { value: v++ }, number: 1 },
            { type: 'test-type', values: { value: v++ }, number: 2 },
          ]);
          await dataStore.addLogs(r1, [
            { type: 'log-type', values: { value: v++ }, number: 1 },
            { type: 'test-type', values: { value: v++ }, number: 2 },
          ]);
          await dataStore.addLogs(r2, [
            { type: 'test-type', values: { value: v++ }, number: 1 },
            { type: 'log-type', values: { value: v++ }, number: 2 },
          ]);
          await dataStore.addLogs(r3, [
            { type: 'test-type', values: { value: v++ }, number: 1 },
            { type: 'log-type', values: { value: v++ }, number: 2 },
          ]);
          use({
            testRunId: r1,
            testRunName,
            testExperimentName,
            testExperimentId,
          });
        },
        { auto: true },
      ],
    })
    .for(['csv', 'json']);

  testWithFormat(
    'filters logs by type (%s)',
    async (format, { expect, hostApi }) => {
      const response = await hostApi
        .get('/logs')
        .query({ 'filter[logType]': 'test-type' })
        .set('Accept', format === 'json' ? apiMediaType : 'text/csv')
        .expect(200);
      expect(
        format === 'json' ? response.body : response.text,
      ).toMatchSnapshot();
    },
  );

  testWithFormat(
    'filters logs by experiment id (%s)',
    async (format, { expect, hostApi, context: { testExperimentId } }) => {
      const response = await hostApi
        .get('/logs')
        .query({ 'filter[experiment.id]': testExperimentId })
        .set('Accept', format === 'json' ? apiMediaType : 'text/csv')
        .expect(200);

      expect(
        format === 'json' ? response.body : response.text,
      ).toMatchSnapshot();
    },
  );

  testWithFormat(
    'filters logs by experiment name (%s)',
    async (format, { expect, hostApi, context: { testExperimentName } }) => {
      const response = await hostApi
        .get('/logs')
        .set('Accept', format === 'json' ? apiMediaType : 'text/csv')
        .query({ 'filter[experiment.name]': testExperimentName })
        .expect(200);

      expect(
        format === 'json' ? response.body : response.text,
      ).toMatchSnapshot();
    },
  );

  testWithFormat(
    'filters logs by run id (%s)',
    async (format, { expect, hostApi, context: { testRunId } }) => {
      const response = await hostApi
        .get('/logs')
        .set('Accept', format === 'json' ? apiMediaType : 'text/csv')
        .query({ 'filter[run.id]': testRunId })
        .expect(200);

      expect(
        format === 'json' ? response.body : response.text,
      ).toMatchSnapshot();
    },
  );

  testWithFormat(
    'filters logs by run name (%s)',
    async (format, { expect, hostApi, context: { testRunName } }) => {
      const response = await hostApi
        .get('/logs')
        .set('Accept', format === 'json' ? apiMediaType : 'text/csv')
        .query({ 'filter[run.name]': testRunName })
        .expect(200);

      expect(
        format === 'json' ? response.body : response.text,
      ).toMatchSnapshot();
    },
  );

  testWithFormat(
    'filters logs by run name, type, and experiment name (%s)',
    async (
      format,
      { expect, hostApi, context: { testRunName, testExperimentName } },
    ) => {
      const response = await hostApi
        .get('/logs')
        .set('Accept', format === 'json' ? apiMediaType : 'text/csv')
        .query({
          'filter[logType]': 'test-type',
          'filter[experiment.name]': testExperimentName,
          'filter[run.name]': testRunName,
        })
        .expect(200);
      expect(response.body).toMatchSnapshot();
    },
  );
});

describe.for(storeTypes)('LogServer: get /logs/{id} (%s)', (storeType) => {
  const it = createTest(storeType);

  it("returns a 404 error if the log is not part of one of the participant's runs", async ({
    dataStore,
    participantApi,
    experimentId,
  }) => {
    const { runId } = await dataStore.addRun({
      experimentId,
      runStatus: 'running',
    });
    const [logRecord] = await dataStore.addLogs(runId, [
      { type: 'log-type', values: { value: 'v' }, number: 1 },
    ]);
    dataStore.getLogs.mockImplementation(async function* () {});
    await participantApi
      .get(`/logs/${logRecord!.logId}`)
      .expect(404, {
        errors: [
          {
            status: 'Not Found',
            code: 'LOG_NOT_FOUND',
            detail: `Log "${logRecord!.logId}" not found`,
          },
        ],
      })
      .expect('Content-Type', apiContentTypeRegExp);
  });

  it('returns a 404 error if the log does not exist', async ({
    participantApi,
  }) => {
    await participantApi
      .get('/logs/does-not-exist')
      .expect(404, {
        errors: [
          {
            status: 'Not Found',
            code: 'LOG_NOT_FOUND',
            detail: 'Log "does-not-exist" not found',
          },
        ],
      })
      .expect('Content-Type', apiContentTypeRegExp);
  });

  it('returns the log', async ({ dataStore, participantApi, runId }) => {
    const [logRecord] = await dataStore.addLogs(runId, [
      { type: 'log-type', values: { value: 'v' }, number: 1 },
    ]);
    const logId = logRecord!.logId;
    await participantApi
      .get(`/logs/${logId}`)
      .expect(200, {
        data: {
          id: logId,
          type: 'logs',
          attributes: {
            logType: 'log-type',
            number: 1,
            values: { value: 'v' },
          },
          relationships: { run: { data: { id: runId, type: 'runs' } } },
        },
      });
  });
});
