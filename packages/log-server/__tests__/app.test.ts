import request from 'supertest';
import { afterEach, describe, beforeEach, it, vi, expect, Mock } from 'vitest';
import { Log, Store, StoreError } from '../src/store.js';
import { createLogServer } from '../src/app.js';

type MockStore = {
  [K in keyof Store]: Store[K] extends (...args: infer A) => infer R
    ? Mock<A, R>
    : Store[K];
};

function MockStore(): MockStore {
  return {
    addRun: vi.fn(
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      async (...args) => {
        return { runId: 'addRun:runId', experimentId: 'addRun:experimentId' };
      },
    ),
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    getRun: vi.fn(async (...args) => {
      return {
        runId: 'getRun:runId',
        experimentId: 'getRun:experimentId',
        createdAt: vi.getMockedSystemTime(),
        status: 'running' as const,
      };
    }),
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    setRunStatus: vi.fn((...args) => Promise.resolve()),
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    addRunLogs: vi.fn((...args) => Promise.resolve()),
    getLogValueNames: vi.fn(() => Promise.resolve(['mock-col1', 'mock-col2'])),
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    getLogs: vi.fn(async function* (): AsyncGenerator<Log> {
      yield {
        experimentId: 'getLogs:experimentId-1',
        runId: 'getLogs:runId-1',
        type: 'getLogs:type-1',
        createdAt: vi.getMockedSystemTime()!,
        clientDate: new Date(0),
        values: {
          'mock-col1': 'log1-mock-value1',
          'mock-col2': 'log1-mock-value2',
        },
      };
      yield {
        experimentId: 'getLogs:experimentId-2',
        runId: 'getLogs:runId-2',
        type: 'getLogs:type-2',
        createdAt: vi.getMockedSystemTime()!,
        clientDate: new Date(0),
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

describe('/sessions', () => {
  let api: request.SuperTest<request.Test>;
  beforeEach(() => {
    let app = createLogServer({
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

    it('should accept the creation of an admin session if there is no admin password set on the server', async () => {
      await api.post('/sessions').send({ role: 'admin' }).expect(201, {
        role: 'admin',
        runs: [],
        status: 'ok',
      });
    });

    it('should accept the creation of an admin role if the provided password is correct', async () => {
      let app = createLogServer({
        store: MockStore(),
        secret: 'secret',
        adminPassword: 'admin password',
      });
      let api = request(app);
      await api
        .post('/sessions')
        .send({ role: 'admin', password: 'admin password' })
        .expect(201, {
          role: 'admin',
          runs: [],
          status: 'ok',
        });
    });

    it('should refuse the creation of an admin role if the provided password is incorrect', async () => {
      let app = createLogServer({
        store: MockStore(),
        secret: 'secret',
        adminPassword: 'admin password',
      });
      let req = request(app);
      await req
        .post('/sessions')
        .send({ role: 'admin', password: 'not the admin password' })
        .expect(403, {
          message: 'Forbidden role: admin',
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

describe('/experiments/runs', () => {
  let store: MockStore;
  let api: request.SuperTest<request.Test>;
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1234567890);
    store = MockStore();
    let app = createLogServer({
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

  describe('post /experiments/runs', () => {
    it('should create a run', async () => {
      await api
        .post('/experiments/runs')
        .send({ experiment: 'exp-id', id: 'run-id' })
        .expect(201, {
          experiment: 'exp-id',
          links: {
            logs: '/experiments/exp-id/runs/run-id/logs',
            run: '/experiments/exp-id/runs/run-id',
          },
          run: 'run-id',
          status: 'ok',
        });
      expect(store.addRun).toHaveBeenCalledWith({
        experimentId: 'exp-id',
        runId: 'run-id',
        createdAt: vi.getMockedSystemTime(),
      });
    });

    it('should use the default experiment if the experiment is not named', async () => {
      await api
        .post('/experiments/runs')
        .send({ id: 'run' })
        .expect(201, {
          status: 'ok',
          experiment: 'default',
          run: 'run',
          links: {
            logs: '/experiments/default/runs/run/logs',
            run: '/experiments/default/runs/run',
          },
        });
      expect(store.addRun).toHaveBeenCalledWith({
        experimentId: 'default',
        runId: 'run',
        createdAt: vi.getMockedSystemTime(),
      });
    });

    it('should generate a unique run id if the run id is not provided', async () => {
      let resp = await api
        .post('/experiments/runs')
        .send({ experiment: 'exp' })
        .expect(201);
      let runId = resp.body.run;
      expect(runId).toBeDefined();
      expect(resp.body).toEqual({
        status: 'ok',
        experiment: 'exp',
        run: runId,
        links: {
          logs: `/experiments/exp/runs/${runId}/logs`,
          run: `/experiments/exp/runs/${runId}`,
        },
      });
      expect(store.addRun).toHaveBeenCalledWith({
        experimentId: 'exp',
        runId,
        createdAt: vi.getMockedSystemTime(),
      });
    });

    it('should add the run to the session', async () => {
      await api
        .post('/experiments/runs')
        .send({ experiment: 'exp-id', id: 'run-id' })
        .expect(201);
      await api.get('/sessions/current').expect(200, {
        role: 'participant',
        runs: [{ id: 'run-id', experiment: 'exp-id' }],
        status: 'ok',
      });
    });

    it('should refuse to create a run if the participant already has one running', async () => {
      await api
        .post('/experiments/runs')
        .send({ experiment: 'exp-id', id: 'run1' })
        .expect(201);
      await api
        .post('/experiments/runs')
        .send({ experiment: 'exp-id', id: 'run2' })
        .expect(403, {
          message: 'Client already has a started run, end it first',
          status: 'error',
        });
    });

    it('should refuse to create a run if the run id already exists', async () => {
      store.addRun.mockImplementation(async ({ runId }) => {
        throw new StoreError(`run "${runId}" already exists`, 'RUN_EXISTS');
      });
      await api
        .post('/experiments/runs')
        .send({ experiment: 'exp-id', id: 'run-id' })
        .expect(400, {
          status: 'error',
          message: 'run "run-id" already exists',
        });
    });
  });

  describe('put /experiments/:experiment/runs/:run', () => {
    it('should return an error if the client does not have access to any run', async () => {
      await api
        .put('/experiments/exp/runs/not-my-run')
        .send({ status: 'completed' })
        .expect(403, {
          status: 'error',
          message: `Client does not have permission to update run "not-my-run" of experiment "exp"`,
        });
    });
    it('should return an error if the client does not have access to this particular run', async () => {
      await api
        .post('/experiments/runs')
        .send({ experiment: 'exp-id', id: 'my-run' })
        .expect(201);
      await api
        .put('/experiments/exp/runs/not-my-run')
        .send({ status: 'completed' })
        .expect(403, {
          status: 'error',
          message: `Client does not have permission to update run "not-my-run" of experiment "exp"`,
        });
    });
    it('should complete a running run if argument is "completed"', async () => {
      await api
        .post('/experiments/runs')
        .send({ experiment: 'exp-id', id: 'my-run' })
        .expect(201);
      await api
        .put('/experiments/exp-id/runs/my-run')
        .send({ status: 'completed' })
        .expect(200, { status: 'ok' });
      expect(store.setRunStatus).toHaveBeenCalledWith(
        'exp-id',
        'my-run',
        'completed',
      );
    });
    it('should cancel a running run if argument is "canceled"', async () => {
      await api
        .post('/experiments/runs')
        .send({ experiment: 'exp-id', id: 'my-run' })
        .expect(201);
      await api
        .put('/experiments/exp-id/runs/my-run')
        .send({ status: 'canceled' })
        .expect(200, { status: 'ok' });
      expect(store.setRunStatus).toHaveBeenCalledWith(
        'exp-id',
        'my-run',
        'canceled',
      );
    });
    it('should revoke client access to the run', async () => {
      await api
        .post('/experiments/runs')
        .send({ experiment: 'exp', id: 'my-run' })
        .expect(201);
      await api
        .put('/experiments/exp/runs/my-run')
        .send({ status: 'completed' })
        .expect(200);
      await api.get('/sessions/current').expect(200, {
        role: 'participant',
        runs: [],
        status: 'ok',
      });
      await api
        .put('/experiments/exp/runs/my-run')
        .send({ status: 'canceled' })
        .expect(403, {
          status: 'error',
          message: `Client does not have permission to update run "my-run" of experiment "exp"`,
        });
    });
  });
});
