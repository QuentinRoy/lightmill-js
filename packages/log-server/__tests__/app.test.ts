/* eslint-disable @typescript-eslint/no-unused-vars */

import request from 'supertest';
import { afterEach, describe, beforeEach, it, vi, expect, Mock } from 'vitest';
import { Log, Store, StoreError } from '../src/store.js';
import { LogServer } from '../src/app.js';
import type { Body } from '@lightmill/log-api';

type MockStore = {
  [K in keyof Store]: Store[K] extends (...args: infer A) => infer R
    ? Mock<A, R>
    : Store[K];
};

function MockStore(): MockStore {
  return {
    addRun: vi.fn(async (...args) => {
      return { runId: 'addRun:runId', experimentId: 'addRun:experimentId' };
    }),
    resumeRun: vi.fn(async (...args) => {
      return {
        runId: 'resumeRun:runId',
        experimentId: 'resumeRun:experimentId',
      };
    }),
    getRun: vi.fn(async (...args) => {
      return {
        runId: 'getRun:runId',
        experimentId: 'getRun:experimentId',
        createdAt: vi.getMockedSystemTime(),
        status: 'running',
      } as const;
    }),
    setRunStatus: vi.fn((...args) => Promise.resolve()),
    addLogs: vi.fn((...args) => Promise.resolve()),
    getLogValueNames: vi.fn(() =>
      Promise.resolve(['mock-col1', 'mock-col2', 'mock-col3']),
    ),
    getLogSummary: vi.fn((...args) =>
      Promise.resolve([
        { type: 'summary:type-1', count: 11, lastNumber: 12, pending: 13 },
        { type: 'summary:type-2', count: 21, lastNumber: 22, pending: 23 },
      ]),
    ),
    getLogs: vi.fn(async function* (): AsyncGenerator<Log> {
      yield {
        experimentId: 'getLogs:experimentId-1',
        runId: 'getLogs:runId-1',
        type: 'getLogs:type-1',
        number: 1,
        values: {
          'mock-col1': 'log1-mock-value1',
          'mock-col2': 'log1-mock-value2',
        },
      };
      yield {
        experimentId: 'getLogs:experimentId-2',
        runId: 'getLogs:runId-2',
        type: 'getLogs:type-2',
        number: 2,
        values: {
          'mock-col1': 'log2-mock-value1',
          'mock-col2': 'log2-mock-value2',
          'mock-col3': 'log2-mock-value3',
        },
      };
    }),
  };
}

afterEach(() => {
  vi.resetAllMocks();
});

describe('sessions', () => {
  let api: request.SuperTest<request.Test>;
  beforeEach(() => {
    let app = LogServer({
      store: MockStore(),
      secret: 'secret',
      secureCookies: false,
    });
    api = request.agent(app);
  });

  describe('post /sessions', () => {
    it('should create a session', async () => {
      await api.post('/sessions').send({ role: 'participant' }).expect(201, {
        role: 'participant',
        runs: [],
        status: 'ok',
      });
    });

    it('should refuse to create a session for an unknown role', async () => {
      await api.post('/sessions').send({ role: 'fake' }).expect(400);
    });

    it('should accept the creation of an host session if there is no host password set on the server', async () => {
      await api.post('/sessions').send({ role: 'host' }).expect(201, {
        role: 'host',
        runs: [],
        status: 'ok',
      });
    });

    it('should accept the creation of an host role if the provided password is correct', async () => {
      let app = LogServer({
        store: MockStore(),
        secret: 'secret',
        hostPassword: 'host password',
      });
      let api = request(app);
      await api
        .post('/sessions')
        .send({ role: 'host', password: 'host password' })
        .expect(201, {
          role: 'host',
          runs: [],
          status: 'ok',
        });
    });

    it('should refuse the creation of an host role if the provided password is incorrect', async () => {
      let app = LogServer({
        store: MockStore(),
        secret: 'secret',
        hostPassword: 'host password',
      });
      let req = request(app);
      await req
        .post('/sessions')
        .send({ role: 'host', password: 'not the host password' })
        .expect(403, {
          message: 'Forbidden role: host',
          status: 'error',
        });
    });
  });

  describe('get /sessions/current', () => {
    it('should return an error if the session does not exists', async () => {
      await api.get('/sessions/current').expect(404, {
        message: 'No session found',
        status: 'error',
      });
    });

    it('should return the current session if it exists', async () => {
      await api.post('/sessions').send({ role: 'participant' }).expect(201);
      await api.get('/sessions/current').expect(200, {
        role: 'participant',
        runs: [],
        status: 'ok',
      });
    });
  });

  describe('delete /sessions/current', () => {
    it('should return an error if the session does not exists', async () => {
      await api.delete('/sessions/current').expect(404, {
        message: 'No session found',
        status: 'error',
      });
    });

    it('should delete the current session if it exists', async () => {
      await api.post('/sessions').send({ role: 'participant' }).expect(201);
      await api.delete('/sessions/current').expect(200, { status: 'ok' });
      await api.get('/sessions/current').expect(404);
    });
  });
});

describe('runs', () => {
  let store: MockStore;
  let api: request.SuperTest<request.Test>;
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1234567890);
    store = MockStore();
    let app = LogServer({
      store,
      secret: 'secret',
      secureCookies: false,
    });
    api = request.agent(app);
    await api.post('/sessions').send({ role: 'participant' });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('post /runs', () => {
    it('should create a run', async () => {
      await api
        .post('/runs')
        .send({ experimentId: 'exp-id', runId: 'run-id' })
        .expect(201, {
          experimentId: 'exp-id',
          runId: 'run-id',
          status: 'ok',
        });
      expect(store.addRun).toHaveBeenCalledWith({
        experimentId: 'exp-id',
        runId: 'run-id',
        createdAt: vi.getMockedSystemTime(),
      });
    });

    it('should use the default experiment if the experiment is not named', async () => {
      await api.post('/runs').send({ runId: 'run' }).expect(201, {
        status: 'ok',
        experimentId: 'default',
        runId: 'run',
      });
      expect(store.addRun).toHaveBeenCalledWith({
        experimentId: 'default',
        runId: 'run',
        createdAt: vi.getMockedSystemTime(),
      });
    });

    it('should generate a unique run id if the run id is not provided', async () => {
      let resp = await api
        .post('/runs')
        .send({ experimentId: 'exp' })
        .expect(201);
      let { runId } = resp.body;
      expect(runId).toBeDefined();
      expect(resp.body).toEqual({ status: 'ok', experimentId: 'exp', runId });
      expect(store.addRun).toHaveBeenCalledWith({
        experimentId: 'exp',
        runId,
        createdAt: vi.getMockedSystemTime(),
      });
    });

    it('should add the run to the session', async () => {
      await api
        .post('/runs')
        .send({ experimentId: 'exp-id', runId: 'run-id' })
        .expect(201);
      await api.get('/sessions/current').expect(200, {
        role: 'participant',
        runs: [{ runId: 'run-id', experimentId: 'exp-id' }],
        status: 'ok',
      });
    });

    it('should refuse to create a run if participant already has one running', async () => {
      await api
        .post('/runs')
        .send({ experimentId: 'exp-id', runId: 'run1' })
        .expect(201);
      await api
        .post('/runs')
        .send({ experimentId: 'exp-id', runId: 'run2' })
        .expect(403, {
          message: 'Client already has started runs, end them first',
          status: 'error',
        });
      expect(store.addRun).toHaveBeenCalledTimes(1);
    });

    it('should refuse to create a run if the run id already exists', async () => {
      store.addRun.mockImplementation(async ({ runId }) => {
        throw new StoreError(`run "${runId}" already exists`, 'RUN_EXISTS');
      });
      await api
        .post('/runs')
        .send({ experimentId: 'exp-id', runId: 'run-id' })
        .expect(403, {
          status: 'error',
          message: 'run "run-id" already exists',
        });
    });
  });

  describe('get /experiments/:experiment/runs/:run', () => {
    it('should return an error if the client does not have access to the run', async () => {
      await api.get('/experiments/exp/runs/not-my-run').expect(403, {
        status: 'error',
        message: `Client does not have permission to access run "not-my-run" of experiment "exp"`,
      });
      expect(store.getRun).not.toHaveBeenCalled();
    });

    it('should return some run information otherwise', async () => {
      await api
        .post('/runs')
        .send({ experimentId: 'exp-id', runId: 'my-run' })
        .expect(201);
      await api.get('/experiments/exp-id/runs/my-run').expect(200, {
        status: 'ok',
        run: {
          runId: 'getRun:runId',
          experimentId: 'getRun:experimentId',
          status: 'running',
          logs: [
            { type: 'summary:type-1', count: 11, lastNumber: 12, pending: 13 },
            { type: 'summary:type-2', count: 21, lastNumber: 22, pending: 23 },
          ],
        },
      });
      expect(store.getRun).toHaveBeenCalledWith('exp-id', 'my-run');
      expect(store.getLogSummary).toHaveBeenCalledWith({
        experimentId: 'exp-id',
        runId: 'my-run',
      });
    });
  });

  describe('patch /experiments/:experiment/runs/:run', () => {
    it('should return an error if the client tries to change the status of the run but does not have access to any run', async () => {
      await api
        .patch('/experiments/exp/runs/not-my-run')
        .send({ status: 'completed' })
        .expect(403, {
          status: 'error',
          message: `Client does not have permission to update run "not-my-run" of experiment "exp"`,
        });
      expect(store.resumeRun).not.toHaveBeenCalled();
      expect(store.setRunStatus).not.toHaveBeenCalled();
    });

    it('should return an error if the client tries to change the status of the run but does not have access to this particular run', async () => {
      await api
        .post('/runs')
        .send({ experimentId: 'exp-id', runId: 'my-run' })
        .expect(201);
      await api
        .patch('/experiments/exp/runs/not-my-run')
        .send({ status: 'completed' })
        .expect(403, {
          status: 'error',
          message: `Client does not have permission to update run "not-my-run" of experiment "exp"`,
        });
      expect(store.setRunStatus).not.toHaveBeenCalled();
      expect(store.resumeRun).not.toHaveBeenCalled();
    });

    it('should return an error if the client tries to resume a run but does not have access to any run', async () => {
      await api
        .patch('/experiments/exp/runs/not-my-run')
        .send({ resumeFrom: 10 })
        .expect(403, {
          status: 'error',
          message: `Client does not have permission to update run "not-my-run" of experiment "exp"`,
        });
      expect(store.resumeRun).not.toHaveBeenCalled();
      expect(store.setRunStatus).not.toHaveBeenCalled();
    });

    it('should return an error if the client tries to resume a run but does not have access to this particular run', async () => {
      await api
        .post('/runs')
        .send({ experimentId: 'exp-id', runId: 'my-run' })
        .expect(201);
      await api
        .patch('/experiments/exp/runs/not-my-run')
        .send({ resumeFrom: 10 })
        .expect(403, {
          status: 'error',
          message: `Client does not have permission to update run "not-my-run" of experiment "exp"`,
        });
      expect(store.resumeRun).not.toHaveBeenCalled();
      expect(store.setRunStatus).not.toHaveBeenCalled();
    });

    it('should complete a running run if argument is "completed"', async () => {
      await api
        .post('/runs')
        .send({ experimentId: 'exp-id', runId: 'my-run' })
        .expect(201);
      await api
        .patch('/experiments/exp-id/runs/my-run')
        .send({ status: 'completed' })
        .expect(200, { status: 'ok' });
      expect(store.setRunStatus).toHaveBeenCalledWith(
        'exp-id',
        'my-run',
        'completed',
      );
      expect(store.resumeRun).not.toHaveBeenCalled();
    });

    it('should cancel a running run if argument is "canceled"', async () => {
      await api
        .post('/runs')
        .send({ experimentId: 'exp-id', runId: 'my-run' })
        .expect(201);
      await api
        .patch('/experiments/exp-id/runs/my-run')
        .send({ status: 'canceled' })
        .expect(200, { status: 'ok' });
      expect(store.setRunStatus).toHaveBeenCalledWith(
        'exp-id',
        'my-run',
        'canceled',
      );
      expect(store.resumeRun).not.toHaveBeenCalled();
    });

    it('should refuse to change the status of a canceled run', async () => {
      store.getRun.mockImplementation(async () => {
        return {
          runId: 'getRun:runId',
          experimentId: 'getRun:experimentId',
          status: 'completed',
        } as const;
      });
      await api
        .post('/runs')
        .send({ experimentId: 'exp-id', runId: 'my-run' })
        .expect(201);
      await api
        .patch('/experiments/exp-id/runs/my-run')
        .send({ status: 'canceled' })
        .expect(400, { status: 'error', message: 'Run has already ended' });
      await api
        .patch('/experiments/exp-id/runs/my-run')
        .send({ status: 'completed' })
        .expect(400, { status: 'error', message: 'Run has already ended' });
      expect(store.setRunStatus).not.toHaveBeenCalled();
      expect(store.resumeRun).not.toHaveBeenCalled();
    });

    it('should not revoke client access to the run even if the run has been completed', async () => {
      await api
        .post('/runs')
        .send({ experimentId: 'exp', runId: 'my-run' })
        .expect(201);
      await api
        .patch('/experiments/exp/runs/my-run')
        .send({ status: 'completed' })
        .expect(200);
      await api.get('/sessions/current').expect(200, {
        role: 'participant',
        runs: [{ runId: 'my-run', experimentId: 'exp' }],
        status: 'ok',
      });
    });

    it('should resume a running run if request body contains "resumeFrom"', async () => {
      await api
        .post('/runs')
        .send({ experimentId: 'exp-id', runId: 'my-run' })
        .expect(201);
      await api
        .patch('/experiments/exp-id/runs/my-run')
        .send({ resumeFrom: 15 })
        .expect(200, { status: 'ok' });
      expect(store.setRunStatus).not.toHaveBeenCalled();
      expect(store.resumeRun).toHaveBeenCalledWith({
        experimentId: 'exp-id',
        runId: 'my-run',
        resumeFrom: 15,
      });
    });

    it('should resume a canceled run if request body contains "resumeFrom"', async () => {
      await api
        .post('/runs')
        .send({ experimentId: 'exp', runId: 'my-run' })
        .expect(201);
      store.getRun.mockImplementation(async () => {
        return {
          runId: 'getRun:runId',
          experimentId: 'getRun:experimentId',
          status: 'canceled',
        } as const;
      });
      await api
        .patch('/experiments/exp/runs/my-run')
        .send({ resumeFrom: 15 })
        .expect(200, { status: 'ok' });
      expect(store.resumeRun).toHaveBeenCalledWith({
        experimentId: 'exp',
        runId: 'my-run',
        resumeFrom: 15,
      });
    });

    it('should refuse to resume a completed run', async () => {
      await api
        .post('/runs')
        .send({ experimentId: 'exp', runId: 'my-run' })
        .expect(201);
      store.getRun.mockImplementation(async () => {
        return {
          runId: 'getRun:runId',
          experimentId: 'getRun:experimentId',
          status: 'completed',
        } as const;
      });
      await api
        .patch('/experiments/exp/runs/my-run')
        .send({ resumeFrom: 15 })
        .expect(400, {
          status: 'error',
          message: `Run has already been completed`,
        });
      expect(store.resumeRun).not.toHaveBeenCalled();
    });

    it('should refuse to resume a run if there is another running run', async () => {
      await api
        .post('/runs')
        .send({ experimentId: 'exp', runId: 'canceled-run' })
        .expect(201);
      store.getRun.mockImplementation(async (experimentId, runId) => {
        return {
          runId: `getRun:${runId}`,
          experimentId: `getRun:${experimentId}`,
          status: runId === 'canceled-run' ? 'canceled' : 'running',
        } as const;
      });
      await api
        .post('/runs')
        .send({ experimentId: 'exp', runId: 'running-run' })
        .expect(201);
      await api
        .patch('/experiments/exp/runs/canceled-run')
        .send({ resumeFrom: 15 })
        .expect(403, {
          status: 'error',
          message: `Client already has other running runs, end them first`,
        });
      expect(store.resumeRun).not.toHaveBeenCalled();
    });
  });
});

describe('logs', () => {
  let store: MockStore;
  let api: request.SuperTest<request.Test>;

  describe('post /experiments/:experiment/runs/:run/logs', () => {
    beforeEach(async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(100100);
      store = MockStore();
      let app = LogServer({
        store,
        secret: 'secret',
        secureCookies: false,
      });
      api = request.agent(app);
      await api.post('/sessions').send({ role: 'participant' });
      await api
        .post('/runs')
        .send({ experimentId: 'test-exp', runId: 'test-run' });
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    type PostLogsBody = Body<
      'post',
      '/experiments/:experimentId/runs/:runId/logs'
    >;

    it('should refuse to add logs if the client does not have access to the run', async () => {
      await api
        .post('/experiments/test-exp/runs/not-my-run/logs')
        .send({
          log: {
            type: 'test-log',
            values: { p1: 'v1', p2: 'v2' },
            number: 1,
          },
        } satisfies PostLogsBody)
        .expect(403, {
          status: 'error',
          message:
            'Client does not have permission to add logs to run "not-my-run" of experiment "test-exp"',
        });
      expect(store.addLogs).not.toHaveBeenCalled();
    });

    it('should add a single log to the run', async () => {
      await api
        .post('/experiments/test-exp/runs/test-run/logs')
        .send({
          log: {
            type: 'test-log',
            values: { p1: 'v1', p2: 'v2' },
            number: 1,
          },
        } satisfies PostLogsBody)
        .expect(201, { status: 'ok' });
      expect(store.addLogs).toHaveBeenCalledWith('test-exp', 'test-run', [
        {
          type: 'test-log',
          values: { p1: 'v1', p2: 'v2' },
          number: 1,
        },
      ]);
    });
    it('should add multiple logs to the run at once', async () => {
      await api
        .post('/experiments/test-exp/runs/test-run/logs')
        .send({
          logs: [
            { type: 'test-log', values: { p1: 'v1', p2: 'v2' }, number: 1 },
            { type: 'test-log', values: { p3: 'v3', p4: 'v4' }, number: 2 },
          ],
        } satisfies PostLogsBody)
        .expect(201, { status: 'ok' });
      expect(store.addLogs).toHaveBeenCalledWith('test-exp', 'test-run', [
        { type: 'test-log', values: { p1: 'v1', p2: 'v2' }, number: 1 },
        { type: 'test-log', values: { p3: 'v3', p4: 'v4' }, number: 2 },
      ]);
    });
  });

  describe('get /experiments/:experiment/logs', () => {
    beforeEach(async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(1234567890);
      store = MockStore();
      let app = LogServer({
        store,
        secret: 'secret',
        secureCookies: false,
      });
      api = request.agent(app);
      await api.post('/sessions').send({ role: 'host' });
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('should refuse to fetch logs if the client is not logged as an host', async () => {
      await api.delete('/sessions/current').expect(200);
      await api.post('/sessions').send({ role: 'participant' }).expect(201);
      await api.get('/experiments/exp/logs').expect(403, {
        status: 'error',
        message: 'Access restricted.',
      });
      expect(store.getLogs).not.toHaveBeenCalled();
    });
    it('should return logs as json by default', async () => {
      let result = await api.get('/experiments/exp/logs').expect(200);
      expect(store.getLogs).toHaveBeenCalledWith({ experimentId: 'exp' });
      expect(result.body).toMatchInlineSnapshot(`
        [
          {
            "experimentId": "getLogs:experimentId-1",
            "number": 1,
            "runId": "getLogs:runId-1",
            "type": "getLogs:type-1",
            "values": {
              "mock-col1": "log1-mock-value1",
              "mock-col2": "log1-mock-value2",
            },
          },
          {
            "experimentId": "getLogs:experimentId-2",
            "number": 2,
            "runId": "getLogs:runId-2",
            "type": "getLogs:type-2",
            "values": {
              "mock-col1": "log2-mock-value1",
              "mock-col2": "log2-mock-value2",
              "mock-col3": "log2-mock-value3",
            },
          },
        ]
      `);
    });
    it('should return logs as json if json is the first supported format in the Accept header', async () => {
      let result = await api
        .get('/experiments/exp/logs')
        .set(
          'Accept',
          'application/xml,application/json,text/csv,application/pdf',
        )
        .expect(200);
      expect(store.getLogs).toHaveBeenCalledWith({ experimentId: 'exp' });
      expect(result.body).toMatchInlineSnapshot(`
        [
          {
            "experimentId": "getLogs:experimentId-1",
            "number": 1,
            "runId": "getLogs:runId-1",
            "type": "getLogs:type-1",
            "values": {
              "mock-col1": "log1-mock-value1",
              "mock-col2": "log1-mock-value2",
            },
          },
          {
            "experimentId": "getLogs:experimentId-2",
            "number": 2,
            "runId": "getLogs:runId-2",
            "type": "getLogs:type-2",
            "values": {
              "mock-col1": "log2-mock-value1",
              "mock-col2": "log2-mock-value2",
              "mock-col3": "log2-mock-value3",
            },
          },
        ]
      `);
    });
    it('should return logs as csv if csv is the first supported format in the Accept header', async () => {
      let result = await api
        .get('/experiments/exp/logs')
        .set(
          'Accept',
          'application/pdf,text/csv,application/json,application/xml',
        )
        .expect(200);
      expect(store.getLogs).toHaveBeenCalledWith({ experimentId: 'exp' });
      expect(result.text).toMatchInlineSnapshot(`
        "type,run_id,mock_col1,mock_col2,mock_col3,number
        getLogs:type-1,getLogs:runId-1,log1-mock-value1,log1-mock-value2,,1
        getLogs:type-2,getLogs:runId-2,log2-mock-value1,log2-mock-value2,log2-mock-value3,2
        "
      `);
    });
    it('should return logs as json if the Accept header is not supported', async () => {
      let result = await api
        .get('/experiments/exp/logs')
        .set('Accept', 'application/xml')
        .expect(200);
      expect(store.getLogs).toHaveBeenCalledWith({ experimentId: 'exp' });
      expect(result.body).toMatchInlineSnapshot(`
        [
          {
            "experimentId": "getLogs:experimentId-1",
            "number": 1,
            "runId": "getLogs:runId-1",
            "type": "getLogs:type-1",
            "values": {
              "mock-col1": "log1-mock-value1",
              "mock-col2": "log1-mock-value2",
            },
          },
          {
            "experimentId": "getLogs:experimentId-2",
            "number": 2,
            "runId": "getLogs:runId-2",
            "type": "getLogs:type-2",
            "values": {
              "mock-col1": "log2-mock-value1",
              "mock-col2": "log2-mock-value2",
              "mock-col3": "log2-mock-value3",
            },
          },
        ]
      `);
    });
    it('should be able to filter logs by type using the type query parameter', async () => {
      await api
        .get('/experiments/exp/logs')
        .query({ type: 'log-type' })
        .expect(200);
      expect(store.getLogs).toHaveBeenCalledWith({
        experimentId: 'exp',
        type: 'log-type',
      });
    });
  });
});
