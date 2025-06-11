/* eslint-disable no-empty-pattern */

import { describe, vi, test as vitestTest } from 'vitest';
import { apiMediaType } from '../src/app-utils.ts';
import { StoreError } from '../src/store.js';
import {
  apiContentTypeRegExp,
  createFixtureWithRuns,
  type FixtureWithRuns,
} from './test-utils.js';

const it = vitestTest.extend<{
  participantFixture: FixtureWithRuns<'participant'>;
  hostFixture: FixtureWithRuns<'host'>;
}>({
  participantFixture: async ({}, use) => {
    const fixture = await createFixtureWithRuns({ role: 'participant' });
    fixture.setRuns([
      {
        runId: 'run-id',
        runName: 'run-name',
        experimentId: fixture.experiment,
        runStatus: 'running' as const,
        runCreatedAt: vi.getMockedSystemTime() ?? new Date(),
      },
    ]);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(100100);
    await use(fixture);
    vi.useRealTimers();
  },
  hostFixture: async ({}, use) => {
    const fixture = await createFixtureWithRuns({ role: 'host' });
    fixture.setRuns([
      {
        runId: 'run-id',
        runName: 'run-name',
        experimentId: fixture.experiment,
        runStatus: 'running' as const,
        runCreatedAt: vi.getMockedSystemTime() ?? new Date(),
      },
    ]);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(100100);
    await use(fixture);
    vi.useRealTimers();
  },
});

describe('LogServer: post /logs', () => {
  it('adds a log', async ({
    expect,
    participantFixture: { api, store, getRuns },
  }) => {
    const runId = getRuns()[0]!.runId;
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
      .expect('location', 'http://lightmill-test.com/logs/l1');

    expect(response.body).toEqual({
      data: { type: 'logs', id: expect.any(String) },
    });
    expect(store.addLogs).toHaveBeenCalledWith(runId, [
      { type: 'test', values: { x: 'x' }, number: 1 },
    ]);
  });

  it('refuses to add logs if the client does not have access to the run', async ({
    expect,
    participantFixture: {
      store,
      sessionStore,
      api,
      setRuns,
      getRuns,
      experiment,
    },
  }) => {
    setRuns([
      ...getRuns(),
      {
        runId: 'not-my-run',
        runName: 'not-my-run',
        experimentId: experiment,
        runStatus: 'running' as const,
        runCreatedAt: vi.getMockedSystemTime() ?? new Date(),
      },
    ]);
    sessionStore.mockGetData({ role: 'participant', runs: ['my-run'] });
    await api
      .post('/logs')
      .set('Content-Type', apiMediaType)
      .send({
        data: {
          type: 'logs',
          attributes: { number: 1, logType: 'test', values: { x: 'x' } },
          relationships: { run: { data: { type: 'runs', id: 'not-my-run' } } },
        },
      })
      .expect(403, {
        errors: [
          {
            status: 'Forbidden',
            code: 'RUN_NOT_FOUND',
            detail: "Run 'not-my-run' not found",
          },
        ],
      })
      .expect('Content-Type', apiContentTypeRegExp);
    expect(store.addLogs).not.toHaveBeenCalled();
  });

  it('allows hosts to add logs to any run', async ({
    hostFixture: { api, sessionStore, getRuns, setRuns, experiment },
  }) => {
    setRuns([
      ...getRuns(),
      {
        runId: 'not-my-run',
        runName: 'not-my-run',
        experimentId: experiment,
        runStatus: 'running' as const,
        runCreatedAt: vi.getMockedSystemTime() ?? new Date(),
      },
    ]);
    sessionStore.mockGetData({ role: 'host', runs: ['my-run'] });
    await api
      .post('/logs')
      .set('Content-Type', apiMediaType)
      .send({
        data: {
          type: 'logs',
          attributes: { number: 1, logType: 'test', values: { x: 'x' } },
          relationships: { run: { data: { type: 'runs', id: 'not-my-run' } } },
        },
      })
      .expect(201);
  });

  it('refuses to add logs to a run that does not exist', async ({
    expect,
    participantFixture: { store, api },
  }) => {
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
  });

  it('refuses to add logs if their number is already in used', async ({
    participantFixture: { store, api, getRuns },
  }) => {
    const runId = getRuns()[0]!.runId;
    store.addLogs.mockImplementation(async () => {
      throw new StoreError(
        'Log number 2 is already used',
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
            detail:
              "Cannot add log to run 'run-id', log number 2 already exists",
          },
        ],
      })
      .expect('Content-Type', apiContentTypeRegExp);
  });
});

describe('LogServer: get /logs', () => {
  it('returns logs as csv by default', async ({
    expect,
    hostFixture: { api, store },
  }) => {
    let result = await api
      .get('/logs')
      .expect(200)
      .expect('Content-Type', /^text\/csv/);
    expect(store.getLogs.mock.calls).toMatchSnapshot();
    expect(result.text).toMatchSnapshot();
  });

  it('returns logs as json if json is the first supported format in the Accept header', async ({
    expect,
    hostFixture: { api, store },
  }) => {
    let result = await api
      .get('/logs')
      .set('Accept', apiMediaType)
      .expect(200)
      .expect('Content-Type', apiContentTypeRegExp);
    expect(store.getLogs.mock.calls).toMatchSnapshot();
    expect(result.body).toMatchSnapshot();
  });

  it('returns logs as csv if csv is the first supported format in the Accept header', async ({
    expect,
    hostFixture: { api, store },
  }) => {
    let result = await api.get('/logs').set('Accept', 'text/csv').expect(200);
    expect(store.getLogs.mock.calls).toMatchSnapshot();
    expect(result.text).toMatchSnapshot();
  });

  it('returns a 400 error if the Accept header is not supported', async ({
    hostFixture: { api },
  }) => {
    await api
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
    participantFixture: { api, store, sessionStore },
  }) => {
    const runBase = {
      experimentId: 'exp',
      runCreatedAt: new Date('2023-01-01'),
      runName: 'run',
      runStatus: 'completed' as const,
    };
    store.getRuns.mockImplementation(async () => [
      { runId: 'that-run', ...runBase },
      { runId: 'another-run', ...runBase },
    ]);
    sessionStore.mockGetData({ role: 'participant', runs: ['that-run'] });

    let result = await api
      .set('Accept', apiMediaType)
      .get('/logs')
      .expect(200)
      .expect('Content-Type', apiContentTypeRegExp);
    expect(store.getLogs.mock.calls).toMatchSnapshot();
    expect(result.body).toMatchSnapshot();
  });

  it('filters logs by type', async ({
    expect,
    hostFixture: { api, store },
  }) => {
    const response = await api
      .get('/logs')
      .set('Accept', apiMediaType)
      .query({ 'filter[logType]': 'log-type' })
      .expect(200)
      .expect('Content-Type', apiContentTypeRegExp);
    expect(store.getLogs.mock.calls).toMatchInlineSnapshot(`
      [
        [
          {
            "experimentId": undefined,
            "logType": "log-type",
            "runId": undefined,
            "runStatus": "-canceled",
          },
        ],
      ]
    `);
    expect(response.body).toMatchSnapshot();
  });

  it('filters logs by experiment', async ({
    expect,
    hostFixture: { api, store },
  }) => {
    const response = await api
      .get('/logs')
      .set('Accept', apiMediaType)
      .query({ 'filter[experiment.id]': 'experiment-id' })
      .expect(200)
      .expect('Content-Type', apiContentTypeRegExp);
    expect(store.getLogs.mock.calls).toMatchInlineSnapshot(`
      [
        [
          {
            "experimentId": "experiment-id",
            "logType": undefined,
            "runId": undefined,
            "runStatus": "-canceled",
          },
        ],
      ]
    `);
    expect(response.body).toMatchSnapshot();
  });

  it('filters logs by run', async ({ expect, hostFixture: { api, store } }) => {
    const response = await api
      .get('/logs')
      .set('Accept', apiMediaType)
      .query({ 'filter[run.id]': 'run-id' })
      .expect(200)
      .expect('Content-Type', apiContentTypeRegExp);
    expect(store.getLogs.mock.calls).toMatchInlineSnapshot(`
      [
        [
          {
            "experimentId": undefined,
            "logType": undefined,
            "runId": "run-id",
            "runStatus": "-canceled",
          },
        ],
      ]
    `);
    expect(response.body).toMatchSnapshot();
  });

  it('filters logs by run, type, and experiment', async ({
    expect,
    hostFixture: { api, store },
  }) => {
    const response = await api
      .get('/logs')
      .set('Accept', apiMediaType)
      .query({
        'filter[logType]': 'log-type',
        'filter[experiment.id]': 'experiment-id',
        'filter[run.id]': 'run-id',
      })
      .expect(200)
      .expect('Content-Type', apiContentTypeRegExp);
    expect(store.getLogs.mock.calls).toMatchInlineSnapshot(`
      [
        [
          {
            "experimentId": "experiment-id",
            "logType": "log-type",
            "runId": "run-id",
            "runStatus": "-canceled",
          },
        ],
      ]
    `);
    expect(response.body).toMatchSnapshot();
  });
});

describe('LogServer: get /logs/{id}', () => {
  it("returns a 404 error if the log is not part of one of the participant's runs", async ({
    expect,
    participantFixture: { api, store },
  }) => {
    store.getLogs.mockImplementation(async function* () {});
    await api
      .get('/logs/not-mine')
      .expect(404, {
        errors: [
          {
            status: 'Not Found',
            code: 'LOG_NOT_FOUND',
            detail: "Log 'not-mine' not found",
          },
        ],
      })
      .expect('Content-Type', apiContentTypeRegExp);
    expect(store.getLogs.mock.calls).toMatchInlineSnapshot(`
      [
        [
          {
            "logId": "not-mine",
            "runId": [
              "run-id",
            ],
            "runStatus": "-canceled",
          },
        ],
      ]
    `);
  });

  it('returns a 404 error if the log does not exist', async ({
    expect,
    hostFixture: { api, store },
  }) => {
    store.getLogs.mockImplementation(async function* () {});
    await api
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
    expect(store.getLogs.mock.calls).toMatchInlineSnapshot(`
      [
        [
          {
            "logId": "does-not-exist",
            "runId": undefined,
            "runStatus": "-canceled",
          },
        ],
      ]
    `);
  });

  it('returns the log', async ({
    expect,
    participantFixture: { api, store },
  }) => {
    store.getLogs.mockImplementation(async function* () {
      yield {
        number: 5,
        logId: 'log-id',
        type: 'log-type',
        experimentId: 'experiment-id',
        experimentName: 'experiment-name',
        runName: 'run-name',
        runStatus: 'running' as const,
        runId: 'run-id',
        createdAt: new Date('2024-01-01T00:00:00Z'),
        values: { x: 'x' },
      };
    });
    let result = await api.get('/logs/log-id').expect(200);
    expect(store.getLogs.mock.calls).toMatchInlineSnapshot(`
      [
        [
          {
            "logId": "log-id",
            "runId": [
              "run-id",
            ],
            "runStatus": "-canceled",
          },
        ],
      ]
    `);
    expect(result.body).toMatchInlineSnapshot(`
      {
        "data": {
          "attributes": {
            "logType": "log-type",
            "number": 5,
            "values": {
              "x": "x",
            },
          },
          "id": "log-id",
          "relationships": {
            "run": {
              "data": {
                "id": "run-id",
                "type": "runs",
              },
            },
          },
          "type": "logs",
        },
      }
    `);
  });
});
