import type { Store as SessionStore } from 'express-session';
import request from 'supertest';
import { beforeEach, describe } from 'vitest';
import { apiMediaType } from '../src/app-utils.ts';
import {
  StoreError,
  type ExperimentId,
  type RunId,
} from '../src/sqlite-store.ts';
import type { DataStore } from '../src/store.ts';
import {
  apiContentTypeRegExp,
  createSessionTest,
  storeTypes,
  type StoreType,
  type WithMockedMethods,
} from './test-utils.js';

type TestContext = {
  runId: RunId;
  experimentId: ExperimentId;
  store: WithMockedMethods<DataStore>;
  sessionStore: WithMockedMethods<SessionStore>;
  participantApi: request.Agent;
  hostApi: request.Agent;
};

function createTest(storeType: StoreType) {
  return createSessionTest({
    storeType,
    sessionType: 'host',
  }).extend<TestContext>({
    experimentId: async ({ expect, hostApi }, use) => {
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

    runId: async ({ expect, experimentId, participantApi }, use) => {
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

    store: async ({ session: { store } }, use) => {
      use(store);
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
    async (userType, { expect, participantApi, runId, store }) => {
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
      expect(store.addLogs).toHaveBeenCalledWith(runId, [
        { type: 'test', values: { x: 'x' }, number: 1 },
      ]);
      expect(response.headers.location).toBe(
        `http://lightmill-test.com/logs/${response.body.data.id}`,
      );
    },
  );

  it('refuses to add logs if client does not have access to the run', async ({
    expect,
    participantApi,
    hostApi,
    experimentId,
    store,
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
            detail: `Run '${response.body.data.id}' not found`,
          },
        ],
      })
      .expect('Content-Type', apiContentTypeRegExp);
    expect(store.addLogs).not.toHaveBeenCalled();
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
    async (userType, { expect, store, participantApi, hostApi }) => {
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
              detail: "Run 'does-not-exist' not found",
            },
          ],
        })
        .expect('Content-Type', apiContentTypeRegExp);
      expect(store.addLogs).not.toHaveBeenCalled();
    },
  );

  it.for(['host', 'participant'] as const)(
    'refuses to add logs if their number is already in used (%s user)',
    async (userType, { participantApi, hostApi, store, runId }) => {
      const api = userType === 'host' ? hostApi : participantApi;
      store.addLogs.mockImplementation(async () => {
        throw new StoreError(
          'Error message that should not be seen by the user',
          StoreError.LOG_NUMBER_EXISTS_IN_SEQUENCE,
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
              detail: `Cannot add log to run '${runId}', log number 2 already exists`,
            },
          ],
        })
        .expect('Content-Type', apiContentTypeRegExp);
    },
  );
});

describe.each(storeTypes)('LogServer: get /logs (%s)', (storeType) => {
  const it = createTest(storeType);

  beforeEach<TestContext>(async ({ store, runId, experimentId }) => {
    await store.addLogs(runId, [
      { type: 'log-type', values: { x: 'x1', y: 'y1' }, number: 1 },
      { type: 'log-type', values: { y: 'y2', x: 'x2' }, number: 2 },
      { type: 'log-type', values: { y: 'y3', x: 'x3' }, number: 3 },
    ]);
    let newRun = await store.addRun({
      runName: 'other-run',
      experimentId,
      runStatus: 'running',
    });
    await store.addLogs(newRun.runId, [
      { type: 'log-type', values: { x: 'x4', y: 'y4' }, number: 1 },
      { type: 'log-type', values: { y: 'y5', x: 'x5' }, number: 2 },
    ]);
  });

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

  it('returns a 400 error if the Accept header is not supported', async ({
    hostApi,
  }) => {
    await hostApi
      .get('/logs')
      .set('Accept', 'application/xml,application/pdf,text/html')
      .expect(400, {
        errors: [
          {
            code: 'HEADERS_VALIDATION',
            detail:
              'must be equal to one of the allowed values: application/vnd.api+json, text/csv',
            source: { header: 'accept' },
            status: 'Bad Request',
          },
        ],
      })
      .expect('Content-Type', apiContentTypeRegExp);
  });

  it('returns only logs a participant has access to', async ({
    expect,
    store,
    experimentId,
    participantApi,
  }) => {
    store.addRun({ runName: 'other-run', experimentId });
    store.addLogs('other-run', [
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
        async ({ store, experimentId: otherExperimentId }, use) => {
          const testRunName = 'log-test-run';
          const testExperimentName = 'log-test-experiment';
          const { experimentId: testExperimentId } = await store.addExperiment({
            experimentName: testExperimentName,
          });
          const { runId: testRunId } = await store.addRun({
            runName: testRunName,
            experimentId: testExperimentId,
            runStatus: 'running',
          });
          const { runId: r1 } = await store.addRun({
            runName: 'other-run-1',
            experimentId: testExperimentId,
            runStatus: 'running',
          });
          const { runId: r2 } = await store.addRun({
            runName: testRunName,
            experimentId: otherExperimentId,
            runStatus: 'running',
          });
          const { runId: r3 } = await store.addRun({
            runName: 'other-run-2',
            experimentId: otherExperimentId,
            runStatus: 'running',
          });
          let v = 1;
          await store.addLogs(testRunId, [
            { type: 'log-type', values: { value: v++ }, number: 1 },
            { type: 'test-type', values: { value: v++ }, number: 2 },
          ]);
          await store.addLogs(r1, [
            { type: 'log-type', values: { value: v++ }, number: 1 },
            { type: 'test-type', values: { value: v++ }, number: 2 },
          ]);
          await store.addLogs(r2, [
            { type: 'test-type', values: { value: v++ }, number: 1 },
            { type: 'log-type', values: { value: v++ }, number: 2 },
          ]);
          await store.addLogs(r3, [
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
    store,
    participantApi,
    experimentId,
  }) => {
    const { runId } = await store.addRun({
      experimentId,
      runStatus: 'running',
    });
    const [{ logId }] = await store.addLogs(runId, [
      { type: 'log-type', values: { value: 'v' }, number: 1 },
    ]);
    store.getLogs.mockImplementation(async function* () {});
    await participantApi
      .get(`/logs/${logId}`)
      .expect(404, {
        errors: [
          {
            status: 'Not Found',
            code: 'LOG_NOT_FOUND',
            detail: `Log '${logId}' not found`,
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
            detail: "Log 'does-not-exist' not found",
          },
        ],
      })
      .expect('Content-Type', apiContentTypeRegExp);
  });

  it('returns the log', async ({ store, participantApi, runId }) => {
    const [{ logId }] = await store.addLogs(runId, [
      { type: 'log-type', values: { value: 'v' }, number: 1 },
    ]);
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
