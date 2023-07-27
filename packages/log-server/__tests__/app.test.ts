import request from 'supertest';
import { afterEach, describe, beforeEach, it, vi } from 'vitest';
import { Store } from '../src/store.js';
import { createLogServer } from '../src/app.js';

function MockStore(init: Partial<Store> = {}): Store {
  return {
    addRun: vi.fn(() => Promise.reject('not implemented')),
    getRun: vi.fn(() => Promise.reject('not implemented')),
    setRunStatus: vi.fn(() => Promise.reject('not implemented')),
    addRunLogs: vi.fn(() => Promise.reject('not implemented')),
    getLogValueNames: vi.fn(() => Promise.reject('not implemented')),
    // eslint-disable-next-line require-yield
    getLogs: vi.fn(async function* () {
      throw new Error('not implemented');
    }),
    ...init,
  };
}

afterEach(() => {
  vi.resetAllMocks();
});

describe('sessions', () => {
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

    it('should accept the creation of an admin role if there is no password', async () => {
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
    it('should fail if the current session does not exists', async () => {
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
    it('should fail if the current session does not exists', async () => {
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
