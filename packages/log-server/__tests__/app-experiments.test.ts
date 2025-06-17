/* eslint-disable no-empty-pattern */

import express from 'express';
import request from 'supertest';
import {
  afterEach,
  describe,
  vi,
  test as vitestTest,
  type TestAPI,
} from 'vitest';
import { apiMediaType } from '../src/app-utils.ts';
import { LogServer } from '../src/app.js';
import { StoreError } from '../src/store-errors.ts';
import { arrayify } from '../src/utils.js';
import {
  MockSessionStore,
  apiContentTypeRegExp,
  createMockStore,
  type MockStore,
} from './test-utils.js';

afterEach(() => {
  vi.resetAllMocks();
});

type FixtureContext = {
  api: request.Agent;
  store: MockStore;
  sessionStore: MockSessionStore;
};
type Fixture = {
  hostSession: FixtureContext & { role: 'host' };
  participantSession: FixtureContext & { role: 'participant' };
};
const initialIt: TestAPI<Fixture> = vitestTest.extend<Fixture>({
  hostSession: async ({}, use) => {
    const role = 'host';
    const { api, store, sessionStore } = await createFixture();
    sessionStore.mockGetData({ role, runs: [] });
    await use({ api, store, sessionStore, role });
  },
  participantSession: async ({}, use) => {
    const role = 'participant';
    const { api, store, sessionStore } = await createFixture();
    sessionStore.mockGetData({ role, runs: [] });
    await use({ api, store, sessionStore, role });
  },
});
const it = initialIt;

async function createFixture() {
  let sessionStore = new MockSessionStore();
  let store = createMockStore();
  let server = LogServer({
    store,
    sessionStore,
    sessionKeys: ['secret'],
    hostPassword: 'host password',
    hostUser: 'host user',
    secureCookies: false,
  });
  let app = express().use(server.middleware);
  let api = request.agent(app).host('lightmill-test.com');
  // This request only matters to get the cookie. After that we'll mock the session anyway.
  await api
    .post('/sessions')
    .set('Content-Type', apiMediaType)
    .send({ data: { type: 'sessions', attributes: { role: 'participant' } } })
    .expect(201);
  vi.clearAllMocks();
  return { api, store, sessionStore };
}

describe('LogServer: post /experiments', () => {
  it('creates an experiment if the session is a host session', async ({
    hostSession: { api },
  }) => {
    await api
      .post('/experiments')
      .set('Content-Type', apiMediaType)
      .send({ data: { type: 'experiments', attributes: { name: 'exp-name' } } })
      .expect('location', 'http://lightmill-test.com/experiments/1')
      .expect(201, { data: { type: 'experiments', id: '1' } })
      .expect('Content-Type', apiContentTypeRegExp);
  });

  it('refuses to create an experiment if the session is not a host session', async ({
    participantSession: { api },
  }) => {
    await api
      .post('/experiments')
      .set('Content-Type', apiMediaType)
      .send({ data: { type: 'experiments', attributes: { name: 'exp-name' } } })
      .expect(403, {
        errors: [
          {
            status: 'Forbidden',
            code: 'FORBIDDEN',
            detail: 'Only hosts can create experiments',
          },
        ],
      })
      .expect('Content-Type', apiContentTypeRegExp);
  });

  it('refuses to create an experiment if there are name conflicts', async ({
    hostSession: { api, store },
  }) => {
    store.addExperiment.mockImplementation(async () => {
      throw new StoreError('message', StoreError.EXPERIMENT_EXISTS);
    });
    await api
      .post('/experiments')
      .set('Content-Type', apiMediaType)
      .send({ data: { type: 'experiments', attributes: { name: 'exp-name' } } })
      .expect(409, {
        errors: [
          {
            status: 'Conflict',
            code: 'EXPERIMENT_EXISTS',
            detail: 'An experiment named "exp-name" already exists',
          },
        ],
      })
      .expect('Content-Type', apiContentTypeRegExp);
  });
});

describe('LogServer: get /experiments', () => {
  function setupStore(store: MockStore) {
    store.getExperiments.mockImplementation(async () =>
      ['exp-1', 'exp-2', 'exp-3'].map((id) => ({
        experimentId: id,
        experimentName: `${id}-name`,
        experimentCreatedAt: new Date('2023-01-01T00:00:00Z'),
      })),
    );
    store.getRuns.mockImplementation(async (filter) => {
      if (filter?.runId != null) {
        let runs = arrayify(filter.runId);
        return runs.map((runId) => {
          let experimentId = /^(exp-\d+)/.exec(runId)?.[1] ?? 'exp-?';
          return {
            runId,
            experimentId,
            runName: `${runId}-name`,
            runCreatedAt: new Date('2023-01-01T00:00:00Z'),
            runStatus: 'running',
          };
        });
      }
      return ['exp-1', 'exp-2', 'exp-1'].map((expId, runNum) => ({
        runId: `run-${runNum + 1}`,
        experimentId: expId,
        runName: `run-${runNum + 1}-name`,
        runCreatedAt: new Date('2023-01-01T00:00:00Z'),
        runStatus: 'running',
      }));
    });
  }
  const it = initialIt.extend<Fixture>({
    hostSession: async ({ hostSession }, use) => {
      setupStore(hostSession.store);
      use(hostSession);
    },
    participantSession: async ({ participantSession }, use) => {
      setupStore(participantSession.store);
      use(participantSession);
    },
  });

  it('returns the list of experiments for hosts', async ({
    hostSession: { api },
  }) => {
    await api.get('/experiments').expect(200, {
      data: [
        {
          id: 'exp-1',
          type: 'experiments',
          attributes: { name: 'exp-1-name' },
        },
        {
          id: 'exp-2',
          type: 'experiments',
          attributes: { name: 'exp-2-name' },
        },
        {
          id: 'exp-3',
          type: 'experiments',
          attributes: { name: 'exp-3-name' },
        },
      ],
    });
  });

  it('returns the list of experiments for participants', async ({
    participantSession: { api },
  }) => {
    await api.get('/experiments').expect(200, {
      data: [
        {
          id: 'exp-1',
          type: 'experiments',
          attributes: { name: 'exp-1-name' },
        },
        {
          id: 'exp-2',
          type: 'experiments',
          attributes: { name: 'exp-2-name' },
        },
        {
          id: 'exp-3',
          type: 'experiments',
          attributes: { name: 'exp-3-name' },
        },
      ],
    });
  });

  it('filters experiments by name when given filter[name] parameter', async ({
    hostSession: { api, store },
  }) => {
    store.getExperiments.mockImplementation(async (filter) => {
      if (filter?.experimentName === 'exp-2-name') {
        return [
          {
            experimentId: 'exp-2',
            experimentName: 'exp-2-name',
            experimentCreatedAt: new Date('2023-01-01T00:00:00Z'),
          },
        ];
      }
      return [];
    });

    await api
      .get('/experiments?filter[name]=exp-2-name')
      .expect(200, {
        data: [
          {
            id: 'exp-2',
            type: 'experiments',
            attributes: { name: 'exp-2-name' },
          },
        ],
      })
      .expect('Content-Type', apiContentTypeRegExp);
  });

  it('returns empty array when no experiments match the name filter', async ({
    hostSession: { api, store },
  }) => {
    store.getExperiments.mockImplementation(async (filter) => {
      if (filter?.experimentName === 'non-existent') {
        return [];
      }
      return [];
    });

    await api
      .get('/experiments?filter[name]=non-existent')
      .expect(200, { data: [] })
      .expect('Content-Type', apiContentTypeRegExp);
  });
});

describe('LogServer: get /experiments/{id}', () => {
  it('returns an experiment by ID', async ({ hostSession: { api, store } }) => {
    store.getExperiments.mockImplementation(async (filter) => {
      if (filter?.experimentId === 'exp-1') {
        return [
          {
            experimentId: 'exp-1',
            experimentName: 'exp-1-name',
            experimentCreatedAt: new Date('2023-01-01T00:00:00Z'),
          },
        ];
      }
      return [];
    });

    store.getRuns.mockImplementation(async (filter) => {
      if (filter?.experimentId === 'exp-1') {
        return [
          {
            runId: 'run-1',
            experimentId: 'exp-1',
            runName: 'run-1-name',
            runCreatedAt: new Date('2023-01-01T00:00:00Z'),
            runStatus: 'completed',
          },
          {
            runId: 'run-2',
            experimentId: 'exp-1',
            runName: 'run-2-name',
            runCreatedAt: new Date('2023-01-02T00:00:00Z'),
            runStatus: 'running',
          },
        ];
      }
      return [];
    });

    await api
      .get('/experiments/exp-1')
      .expect(200, {
        data: {
          id: 'exp-1',
          type: 'experiments',
          attributes: { name: 'exp-1-name' },
        },
      })
      .expect('Content-Type', apiContentTypeRegExp);
  });

  it('returns 404 for non-existent experiment', async ({
    hostSession: { api, store },
  }) => {
    store.getExperiments.mockImplementation(async () => []);
    await api
      .get('/experiments/non-existent')
      .expect(404, {
        errors: [
          {
            status: 'Not Found',
            code: 'EXPERIMENT_NOT_FOUND',
            detail: 'Experiment non-existent not found',
          },
        ],
      })
      .expect('Content-Type', apiContentTypeRegExp);
  });
});
