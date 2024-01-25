/* eslint-disable @typescript-eslint/no-unused-vars */

import request from 'supertest';
import { afterEach, describe, beforeEach, it, vi, expect, Mock } from 'vitest';
import {
  Log,
  RunFilter,
  RunId,
  RunStatus,
  Store,
  StoreError,
} from '../src/store.js';
import { LogServer } from '../src/app.js';
import type { Body } from '@lightmill/log-api';
import { arrayify } from '../src/utils.js';

type MockStore = {
  [K in keyof Store]: Store[K] extends (...args: infer A) => infer R
    ? Mock<A, R>
    : Store[K];
};

function MockStore(): MockStore {
  return {
    addRun: vi.fn(async (...args) => {
      return {
        runId: 1 as RunId,
        runName: 'addRun:runName',
        experimentName: 'addRun:experimentName',
        runStatus: 'idle' as const,
      };
    }),
    resumeRun: vi.fn(async (...args) => {
      return;
    }),
    getRuns: vi.fn(async (...args) => {
      return [
        {
          runId: 1 as RunId,
          runName: 'getRun:runName',
          experimentName: 'getRun:experimentName',
          runCreatedAt: vi.getMockedSystemTime() ?? new Date(),
          runStatus: 'running' as const,
        },
      ];
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
        runId: 1,
        runStatus: 'running',
        experimentName: 'getLogs:experimentName-1',
        runName: 'getLogs:runName-1',
        type: 'getLogs:type-1',
        number: 1,
        values: {
          'mock-col1': 'log1-mock-value1',
          'mock-col2': 'log1-mock-value2',
        },
      };
      yield {
        runId: 2,
        runStatus: 'completed',
        experimentName: 'getLogs:experimentName-2',
        runName: 'getLogs:runName-2',
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
  let api: request.Agent;
  beforeEach(() => {
    let app = LogServer({
      store: MockStore(),
      secret: 'secret',
      secureCookies: false,
    });
    api = request.agent(app);
  });

  describe('put /sessions/current', () => {
    it('should create a session', async ({ expect }) => {
      await api
        .put('/sessions/current')
        .send({ role: 'participant' })
        .expect(201, {
          role: 'participant',
          runs: [],
          status: 'ok',
        });
    });

    it('should refuse to create a session for an unknown role', async ({
      expect,
    }) => {
      await api.put('/sessions/current').send({ role: 'fake' }).expect(400);
    });

    it('should accept the creation of an host session if there is no host password set on the server', async ({
      expect,
    }) => {
      await api.put('/sessions/current').send({ role: 'host' }).expect(201, {
        role: 'host',
        runs: [],
        status: 'ok',
      });
    });

    it('should accept the creation of an host role if the provided password is correct', async ({
      expect,
    }) => {
      let app = LogServer({
        store: MockStore(),
        secret: 'secret',
        hostPassword: 'host password',
      });
      let api = request(app);
      await api
        .put('/sessions/current')
        .send({ role: 'host', password: 'host password' })
        .expect(201, { role: 'host', runs: [], status: 'ok' });
    });

    it('should refuse the creation of an host role if the provided password is incorrect', async ({
      expect,
    }) => {
      let app = LogServer({
        store: MockStore(),
        secret: 'secret',
        hostPassword: 'host password',
      });
      let req = request(app);
      await req
        .put('/sessions/current')
        .send({ role: 'host', password: 'not the host password' })
        .expect(403, {
          message: 'Forbidden role: host',
          status: 'error',
        });
    });
  });

  describe('get /sessions/current', () => {
    it('should return an error if the session does not exists', async ({
      expect,
    }) => {
      await api.get('/sessions/current').expect(404, {
        message: 'No session found',
        status: 'error',
      });
    });

    it('should return the current session if it exists', async ({ expect }) => {
      await api.put('/sessions/current').send({ role: 'participant' });
      await api.get('/sessions/current').expect(200, {
        role: 'participant',
        runs: [],
        status: 'ok',
      });
    });
  });

  describe('delete /sessions/current', () => {
    it('should return an error if the session does not exists', async ({
      expect,
    }) => {
      await api.delete('/sessions/current').expect(404, {
        message: 'No session found',
        status: 'error',
      });
    });

    it('should delete the current session if it exists', async ({ expect }) => {
      await api.put('/sessions/current').send({ role: 'participant' });
      await api.delete('/sessions/current').expect(200, { status: 'ok' });
      await api.get('/sessions/current').expect(404);
    });
  });
});

describe('runs', () => {
  let store: MockStore;
  let api: request.Agent;
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
    it('should create a run', async ({ expect }) => {
      await api
        .post('/runs')
        .send({ experimentName: 'exp-id', runName: 'run-id' })
        .expect(201, {
          experimentName: 'addRun:experimentName',
          runName: 'addRun:runName',
          status: 'ok',
          runStatus: 'idle',
        });
      expect(store.addRun).toHaveBeenCalledWith({
        experimentName: 'exp-id',
        runName: 'run-id',
      });
    });

    it('should use the default experiment if the experiment is not named', async ({
      expect,
    }) => {
      await api.post('/runs').send({ runName: 'run' }).expect(201, {
        experimentName: 'addRun:experimentName',
        runName: 'addRun:runName',
        status: 'ok',
        runStatus: 'idle',
      });
      expect(store.addRun).toHaveBeenCalledWith({
        experimentName: 'default',
        runName: 'run',
      });
    });

    it('should generate a unique run name if the run name is not provided', async ({
      expect,
    }) => {
      let resp = await api
        .post('/runs')
        .send({ experimentName: 'exp' })
        .expect(201);
      expect(resp.body).toEqual({
        status: 'ok',
        experimentName: 'addRun:experimentName',
        runName: 'addRun:runName',
        runStatus: 'idle',
      });
      let call = store.addRun.mock.calls[0][0];
      expect(call).toMatchObject({
        experimentName: 'exp',
        runStatus: undefined,
      });
      expect(call.runName).toBeTypeOf('string');
    });

    it('should add the run to the session', async ({ expect }) => {
      await api
        .post('/runs')
        .send({ experimentName: 'exp-id', runName: 'run-id' })
        .expect(201);
      await api.get('/sessions/current').expect(200, {
        role: 'participant',
        runs: [
          {
            runName: 'getRun:runName',
            experimentName: 'getRun:experimentName',
            runCreatedAt: '1970-01-15T06:56:07.890Z',
            runStatus: 'running',
          },
        ],
        status: 'ok',
      });
    });

    it('should refuse to create a run if participant already has one running', async ({
      expect,
    }) => {
      await api
        .post('/runs')
        .send({ experimentName: 'exp-id', runName: 'run1' })
        .expect(201);
      await api
        .post('/runs')
        .send({ experimentName: 'exp-id', runName: 'run2' })
        .expect(403, {
          message: 'Client already has started runs, end them first',
          status: 'error',
        });
      expect(store.addRun).toHaveBeenCalledTimes(1);
    });

    it('should refuse to create a run if the run id already exists', async ({
      expect,
    }) => {
      store.addRun.mockImplementation(async ({ runName }) => {
        throw new StoreError(`run "${runName}" already exists`, 'RUN_EXISTS');
      });
      await api
        .post('/runs')
        .send({ experimentName: 'exp-id', runName: 'run-id' })
        .expect(403, {
          status: 'error',
          message: 'run "run-id" already exists',
        });
    });
  });

  describe('get /experiments/:experiment/runs/:run', () => {
    it('should return an error if the client does not have access to any run', async ({
      expect,
    }) => {
      store.getRuns.mockImplementation(async () => []);
      await api.get('/experiments/exp/runs/not-my-run').expect(403, {
        status: 'error',
        message: `Client does not have permission to access run "not-my-run" of experiment "exp"`,
      });
    });

    it('should return an error if the client does not have access to this particular run', async ({
      expect,
    }) => {
      let myRuns = [
        {
          runId: 999 as RunId,
          runName: 'my-run',
          experimentName: 'exp',
          runStatus: 'running' as const,
          runCreatedAt: vi.getMockedSystemTime() ?? new Date(),
        },
      ];
      store.getRuns.mockImplementation(async (filter) => {
        if (arrayify(filter?.runName, true).includes('not-my-run')) {
          return [];
        }
        return myRuns;
      });
      await api.get('/experiments/exp/runs/not-my-run').expect(403, {
        status: 'error',
        message: `Client does not have permission to access run "not-my-run" of experiment "exp"`,
      });
    });

    it('should return some run information otherwise', async ({ expect }) => {
      await api
        .post('/runs')
        .send({ experimentName: 'exp', runName: 'my-run' })
        .expect(201);
      await api.get('/experiments/exp-id/runs/my-run').expect(200, {
        status: 'ok',
        run: {
          runName: 'getRun:runName',
          experimentName: 'getRun:experimentName',
          runStatus: 'running',
          logs: [
            { type: 'summary:type-1', count: 11, lastNumber: 12, pending: 13 },
            { type: 'summary:type-2', count: 21, lastNumber: 22, pending: 23 },
          ],
        },
      });
    });
  });

  describe('patch /experiments/:experiment/runs/:run', () => {
    it('should return an error if the client tries to change the status of the run but does not have access to any run', async ({
      expect,
    }) => {
      store.getRuns.mockImplementation(async () => []);
      await api
        .patch('/experiments/exp/runs/not-my-run')
        .send({ runStatus: 'completed' })
        .expect(403, {
          status: 'error',
          message: `Client does not have permission to access run "not-my-run" of experiment "exp"`,
        });
      expect(store.resumeRun).not.toHaveBeenCalled();
      expect(store.setRunStatus).not.toHaveBeenCalled();
    });

    it('should return an error if the client tries to change the status of the run but does not have access to this particular run', async ({
      expect,
    }) => {
      let myRuns = [
        {
          runId: 999 as RunId,
          runName: 'my-run',
          experimentName: 'exp',
          runStatus: 'running' as const,
          runCreatedAt: vi.getMockedSystemTime() ?? new Date(),
        },
      ];
      store.getRuns.mockImplementation(async (filter) => {
        if (arrayify(filter?.runName, true).includes('not-my-run')) {
          return [];
        }
        return myRuns;
      });
      await api
        .post('/runs')
        .send({ experimentName: 'exp', runName: 'my-run' })
        .expect(201);
      await api
        .patch('/experiments/exp/runs/not-my-run')
        .send({ runStatus: 'completed' })
        .expect(403, {
          status: 'error',
          message: `Client does not have permission to access run "not-my-run" of experiment "exp"`,
        });
      expect(store.setRunStatus).not.toHaveBeenCalled();
      expect(store.resumeRun).not.toHaveBeenCalled();
    });

    it('should return an error if the client tries to resume a run but does not have access to any run', async ({
      expect,
    }) => {
      store.getRuns.mockImplementation(async () => []);
      await api
        .patch('/experiments/exp/runs/not-my-run')
        .send({ resumeFrom: 10, runStatus: 'running' })
        .expect(403, {
          status: 'error',
          message: `Client does not have permission to access run "not-my-run" of experiment "exp"`,
        });
      expect(store.resumeRun).not.toHaveBeenCalled();
      expect(store.setRunStatus).not.toHaveBeenCalled();
    });

    it('should return an error if the client tries to resume a run but does not have access to this particular run', async ({
      expect,
    }) => {
      let myRuns = [
        {
          runId: 999 as RunId,
          runName: 'my-run',
          experimentName: 'exp',
          runStatus: 'running' as const,
          runCreatedAt: vi.getMockedSystemTime() ?? new Date(),
        },
      ];
      store.getRuns.mockImplementation(async (filter) => {
        if (arrayify(filter?.runName, true).includes('not-my-run')) {
          return [];
        }
        return myRuns;
      });
      await api
        .post('/runs')
        .send({ experimentName: 'exp-id', runName: 'my-run' })
        .expect(201);
      await api
        .patch('/experiments/exp/runs/not-my-run')
        .send({ resumeFrom: 10, runStatus: 'running' })
        .expect(403, {
          status: 'error',
          message: `Client does not have permission to access run "not-my-run" of experiment "exp"`,
        });
      expect(store.resumeRun).not.toHaveBeenCalled();
      expect(store.setRunStatus).not.toHaveBeenCalled();
    });

    it('should complete a running run if argument is "completed"', async ({
      expect,
    }) => {
      const storeRun = {
        runId: 999 as RunId,
        runName: 'my-run',
        experimentName: 'my-exp',
        runStatus: 'running' as const,
        runCreatedAt: vi.getMockedSystemTime() ?? new Date(),
      };
      store.addRun.mockImplementation(async () => storeRun);
      store.getRuns.mockImplementation(async (opt) => {
        if (
          opt?.runId === storeRun.runId ||
          (Array.isArray(opt?.runId) && opt.runId.includes(storeRun.runId))
        ) {
          return [storeRun];
        }
        return [];
      });
      await api
        .post('/runs')
        .send({ experimentName: 'my-exp', runName: 'my-run' })
        .expect(201);
      await api
        .patch('/experiments/my-exp/runs/my-run')
        .send({ runStatus: 'completed' })
        .expect(200, { status: 'ok' });
      expect(store.setRunStatus).toHaveBeenCalledWith(999, 'completed');
      expect(store.resumeRun).not.toHaveBeenCalled();
    });

    it('should cancel a running run if argument is "canceled"', async ({
      expect,
    }) => {
      await api
        .post('/runs')
        .send({ experimentName: 'my-exp', runName: 'my-run' })
        .expect(201);
      await api
        .patch('/experiments/my-exp/runs/my-run')
        .send({ runStatus: 'canceled' })
        .expect(200, { status: 'ok' });
      expect(store.setRunStatus).toHaveBeenCalledWith(1, 'canceled');
      expect(store.resumeRun).not.toHaveBeenCalled();
    });

    it('should refuse to change the status of a completed run', async ({
      expect,
    }) => {
      store.getRuns.mockImplementation(async () => {
        return [
          {
            runId: 1 as RunId,
            runName: 'getRun:runName',
            experimentName: 'getRun:experimentName',
            runStatus: 'completed' as const,
            runCreatedAt: vi.getMockedSystemTime() ?? new Date(),
          },
        ];
      });
      await api
        .post('/runs')
        .send({ experimentName: 'exp-id', runName: 'my-run' })
        .expect(201);
      await api
        .patch('/experiments/exp-id/runs/my-run')
        .send({ runStatus: 'canceled' })
        .expect(400, {
          status: 'error',
          message: 'Cannot cancel a completed run',
        });
      await api
        .patch('/experiments/exp-id/runs/my-run')
        .send({ runStatus: 'completed' })
        .expect(400, {
          status: 'error',
          message: 'Run is already completed',
        });
      expect(store.setRunStatus).not.toHaveBeenCalled();
      expect(store.resumeRun).not.toHaveBeenCalled();
    });

    it('should refuse to change the status of a canceled run', async ({
      expect,
    }) => {
      store.getRuns.mockImplementation(async () => {
        return [
          {
            runId: 1 as RunId,
            runName: 'getRun:runName',
            experimentName: 'getRun:experimentName',
            runStatus: 'canceled' as const,
            runCreatedAt: vi.getMockedSystemTime() ?? new Date(),
          },
        ];
      });
      await api
        .post('/runs')
        .send({ experimentName: 'exp-id', runName: 'my-run' })
        .expect(201);
      await api
        .patch('/experiments/exp-id/runs/my-run')
        .send({ runStatus: 'completed' })
        .expect(400, {
          status: 'error',
          message: 'Cannot complete a canceled run',
        });
      await api
        .patch('/experiments/exp-id/runs/my-run')
        .send({ runStatus: 'canceled' })
        .expect(400, {
          status: 'error',
          message: 'Run is already canceled',
        });
      expect(store.setRunStatus).not.toHaveBeenCalled();
      expect(store.resumeRun).not.toHaveBeenCalled();
    });

    it('should resume a running run if request body contains "resumeFrom"', async ({
      expect,
    }) => {
      await api
        .post('/runs')
        .send({ experimentName: 'exp', runName: 'my-run' })
        .expect(201);
      await api
        .patch('/experiments/exp/runs/my-run')
        .send({ runStatus: 'running', resumeFrom: 15 })
        .expect(200, { status: 'ok' });
      expect(store.setRunStatus).not.toHaveBeenCalled();
      expect(store.resumeRun).toHaveBeenCalledWith(1, { from: 15 });
    });

    it('should resume an interrupted run if request body contains "resumeFrom"', async ({
      expect,
    }) => {
      let myRun = {
        runId: 666 as RunId,
        runName: 'getRun:runName',
        experimentName: 'getRun:experimentName',
        runStatus: 'interrupted' as const,
        runCreatedAt: vi.getMockedSystemTime() ?? new Date(),
      };
      store.addRun.mockImplementation(async () => myRun);
      store.getRuns.mockImplementation(async () => [myRun]);
      await api
        .post('/runs')
        .send({ experimentName: 'exp', runName: 'my-run' })
        .expect(201);
      await api
        .patch('/experiments/exp/runs/my-run')
        .send({ runStatus: 'running', resumeFrom: 12 })
        .expect(200, { status: 'ok' });
      expect(store.resumeRun).toHaveBeenCalledWith(666, { from: 12 });
    });

    it('should refuse to resume a completed run', async ({ expect }) => {
      await api
        .post('/runs')
        .send({ experimentName: 'exp', runName: 'my-run' })
        .expect(201);
      store.getRuns.mockImplementation(async () => {
        return [
          {
            runId: 1 as RunId,
            runName: 'getRun:runName',
            experimentName: 'getRun:experimentName',
            runStatus: 'completed' as const,
            runCreatedAt: vi.getMockedSystemTime() ?? new Date(),
          },
        ];
      });
      await api
        .patch('/experiments/exp/runs/my-run')
        .send({ runStatus: 'running', resumeFrom: 15 })
        .expect(400, {
          status: 'error',
          message: `Cannot resume a completed run`,
        });
      expect(store.resumeRun).not.toHaveBeenCalled();
    });

    it('should refuse to resume a canceled run', async ({ expect }) => {
      await api
        .post('/runs')
        .send({ experimentName: 'exp', runName: 'my-run' })
        .expect(201);
      store.getRuns.mockImplementation(async () => {
        return [
          {
            runId: 1 as RunId,
            runName: 'getRun:runName',
            experimentName: 'getRun:experimentName',
            runStatus: 'canceled' as const,
            runCreatedAt: vi.getMockedSystemTime() ?? new Date(),
          },
        ];
      });
      await api
        .patch('/experiments/exp/runs/my-run')
        .send({ runStatus: 'running', resumeFrom: 15 })
        .expect(400, {
          status: 'error',
          message: `Cannot resume a canceled run`,
        });
      expect(store.resumeRun).not.toHaveBeenCalled();
    });
  });
});

describe('logs', () => {
  let store: MockStore;
  let api: request.Agent;
  let myRun: {
    runId: RunId;
    runName: string;
    experimentName: string;
    runStatus: RunStatus;
    runCreatedAt: Date;
  };

  describe('post /experiments/:experiment/runs/:run/logs', () => {
    beforeEach(async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(100100);
      myRun = {
        runId: 111 as RunId,
        runName: 'test-run',
        experimentName: 'test-exp',
        runStatus: 'running' as const,
        runCreatedAt: vi.getMockedSystemTime() ?? new Date(),
      };
      store = MockStore();
      let app = LogServer({
        store,
        secret: 'secret',
        secureCookies: false,
      });
      api = request.agent(app);
      store.addRun.mockImplementation(async () => myRun);
      store.getRuns.mockImplementation(async () => [myRun]);
      await api.post('/sessions').send({ role: 'participant' });
      await api
        .post('/runs')
        .send({ experimentName: 'test-exp', runName: 'test-run' });
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    type PostLogsBody = Body<
      'post',
      '/experiments/:experimentName/runs/:runName/logs'
    >;

    it('should refuse to add logs if the client does not have access to the run', async ({
      expect,
    }) => {
      store.getRuns.mockImplementation(async (filter) => {
        if (arrayify(filter?.runName, true).includes('not-my-run')) {
          return [];
        } else {
          return [myRun];
        }
      });
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

    it('should add a single log to the run', async ({ expect }) => {
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
      expect(store.addLogs).toHaveBeenCalledWith(myRun.runId, [
        {
          type: 'test-log',
          values: { p1: 'v1', p2: 'v2' },
          number: 1,
        },
      ]);
    });

    it('should add multiple logs to the run at once', async ({ expect }) => {
      await api
        .post('/experiments/test-exp/runs/test-run/logs')
        .send({
          logs: [
            { type: 'test-log', values: { p1: 'v1', p2: 'v2' }, number: 1 },
            { type: 'test-log', values: { p3: 'v3', p4: 'v4' }, number: 2 },
          ],
        } satisfies PostLogsBody)
        .expect(201, { status: 'ok' });
      expect(store.addLogs).toHaveBeenCalledWith(myRun.runId, [
        { type: 'test-log', values: { p1: 'v1', p2: 'v2' }, number: 1 },
        { type: 'test-log', values: { p3: 'v3', p4: 'v4' }, number: 2 },
      ]);
    });

    it('should refuse to add logs if the store says that their number is already used', async ({
      expect,
    }) => {
      store.addLogs.mockImplementation(async () => {
        throw new StoreError(
          'Log number 2 is already used',
          'LOG_NUMBER_EXISTS_IN_SEQUENCE',
        );
      });
      await api
        .post('/experiments/test-exp/runs/test-run/logs')
        .send({
          logs: [
            { type: 'test-log', values: { p1: 'v4', p2: 'v5' }, number: 2 },
            { type: 'test-log', values: { p3: 'v3', p4: 'v4' }, number: 3 },
          ],
        } satisfies PostLogsBody)
        .expect(403, {
          status: 'error',
          message: 'Log number 2 is already used',
        });
    });
  });

  describe('get /experiments/:experiment/logs', () => {
    beforeEach(async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(1234567890);
      store = MockStore();
      let app = LogServer({ store, secret: 'secret', secureCookies: false });
      api = request.agent(app);
      await api.put('/sessions/current').send({ role: 'host' });
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('should refuse to fetch logs if the client is not logged as an host', async ({
      expect,
    }) => {
      await api.delete('/sessions/current').expect(200);
      await api
        .put('/sessions/current')
        .send({ role: 'participant' })
        .expect(201);
      await api.get('/experiments/exp/logs').expect(403, {
        status: 'error',
        message: 'Access restricted.',
      });
      expect(store.getLogs).not.toHaveBeenCalled();
    });

    it('should return logs as json by default', async ({ expect }) => {
      let result = await api.get('/experiments/exp/logs').expect(200);
      expect(store.getLogs.mock.calls).toMatchSnapshot();
      expect(result.body).toMatchSnapshot();
    });
    it('should return logs as json if json is the first supported format in the Accept header', async ({
      expect,
    }) => {
      let result = await api
        .get('/experiments/exp/logs')
        .set(
          'Accept',
          'application/xml,application/json,text/csv,application/pdf',
        )
        .expect(200);
      expect(store.getLogs.mock.calls).toMatchSnapshot();
      expect(result.body).toMatchSnapshot();
    });
    it('should return logs as csv if csv is the first supported format in the Accept header', async ({
      expect,
    }) => {
      let result = await api
        .get('/experiments/exp/logs')
        .set(
          'Accept',
          'application/pdf,text/csv,application/json,application/xml',
        )
        .expect(200);
      expect(store.getLogs.mock.calls).toMatchSnapshot();
      expect(result.text).toMatchSnapshot();
    });

    it('should return logs as json if the Accept header is not supported', async ({
      expect,
    }) => {
      let result = await api
        .get('/experiments/exp/logs')
        .set('Accept', 'application/xml')
        .expect(200);
      expect(store.getLogs.mock.calls).toMatchSnapshot();
      expect(result.body).toMatchSnapshot();
    });

    it('should be able to filter logs by type using the type query parameter', async ({
      expect,
    }) => {
      await api
        .get('/experiments/exp/logs')
        .query({ type: 'log-type' })
        .expect(200);
      expect(store.getLogs.mock.calls).toMatchSnapshot();
    });
  });
});
