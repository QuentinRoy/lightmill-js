/* eslint-disable no-empty-pattern */
import express from 'express';
import request from 'supertest';
import {
  afterEach,
  describe,
  expect,
  vi,
  test as vitestTest,
  type TestAPI,
} from 'vitest';
import { apiMediaType } from '../src/app-utils.js';
import { LogServer } from '../src/app.js';
import { SQLiteStore } from '../src/store.js';
import { apiContentTypeRegExp } from './test-utils.js';

// Reset after each test
afterEach(() => {
  vi.resetAllMocks();
});

// Define fixture context types
type FixtureContext = { api: request.Agent };
type App = NonNullable<Parameters<typeof request.agent>[0]>;
type Fixture = {
  app: App;
  hostSession: FixtureContext & { role: 'host' };
  participantSession: FixtureContext & { role: 'participant' };
};

// Create fixtures using vitest's extend
const baseTest: TestAPI<Fixture> = vitestTest.extend<Fixture>({
  app: async ({}, use) => {
    // Create real in-memory database
    const store = new SQLiteStore(':memory:');
    await store.migrateDatabase();
    // Server setup with real stores
    const server = LogServer({
      store,
      sessionKeys: ['integration-test-secret'],
      hostUser: 'admin',
      hostPassword: 'password',
      secureCookies: false,
    });
    // Express app setup
    const app = express().use(server.middleware);
    await use(app);
    // Clean up after test
    await store.close();
  },

  // Host session fixture
  hostSession: async ({ app }, use) => {
    // Create authenticated host agent
    const api = request.agent(app);
    await api
      .post('/sessions')
      .auth('admin', 'password')
      .set('Content-Type', apiMediaType)
      .send({ data: { type: 'sessions', attributes: { role: 'host' } } })
      .expect(201);

    await use({ api, role: 'host' });
  },

  // Participant session fixture
  participantSession: async ({ app }, use) => {
    // Create authenticated participant agent
    const api = request.agent(app);
    await api
      .post('/sessions')
      .set('Content-Type', apiMediaType)
      .send({ data: { type: 'sessions', attributes: { role: 'participant' } } })
      .expect(201);

    await use({ api, role: 'participant' });
  },
});

describe('Integration - Authentication', () => {
  const it = baseTest.extend<{ agent: request.Agent }>({
    agent: async ({ app }, use) => {
      const agent = request.agent(app);
      await use(agent);
    },
  });

  it('creates a valid participant session', async ({ agent }) => {
    const response = await agent
      .post('/sessions')
      .set('Content-Type', apiMediaType)
      .send({ data: { type: 'sessions', attributes: { role: 'participant' } } })
      .expect(201);

    expect(response.body.data.attributes.role).toBe('participant');
  });

  it('creates a host session with valid credentials', async ({ agent }) => {
    const response = await agent
      .post('/sessions')
      .auth('admin', 'password')
      .set('Content-Type', apiMediaType)
      .send({ data: { type: 'sessions', attributes: { role: 'host' } } })
      .expect(201);

    expect(response.body.data.attributes.role).toBe('host');
  });

  it('rejects host creation with invalid credentials', async ({ agent }) => {
    await agent
      .post('/sessions')
      .auth('admin', 'wrong-password')
      .set('Content-Type', apiMediaType)
      .send({ data: { type: 'sessions', attributes: { role: 'host' } } })
      .expect(403);
  });
});

describe('Integration - Experiment Management', () => {
  const it = baseTest;
  it('creates and retrieves experiments as host', async ({
    hostSession: { api },
  }) => {
    // Create experiment
    const experimentName = `test-experiment`;
    const createResponse = await api
      .post('/experiments')
      .set('Content-Type', apiMediaType)
      .send({
        data: { type: 'experiments', attributes: { name: experimentName } },
      })
      .expect(201)
      .expect('Content-Type', apiContentTypeRegExp);

    const experimentId = createResponse.body.data.id;
    expect(experimentId).toBeDefined();

    // Get experiment
    const getResponse = await api
      .get(`/experiments/${experimentId}`)
      .expect(200)
      .expect('Content-Type', apiContentTypeRegExp);

    expect(getResponse.body.data.attributes.name).toBe(experimentName);

    // List experiments
    const listResponse = await api
      .get('/experiments')
      .expect(200)
      .expect('Content-Type', apiContentTypeRegExp);

    expect(listResponse.body.data).toBeInstanceOf(Array);
    expect(listResponse.body.data).toSatisfy((data: Array<{ id: unknown }>) =>
      data.some((exp: { id: unknown }) => exp.id === experimentId),
    );
  });

  it('prevents participants from creating experiments', async ({
    participantSession: { api },
  }) => {
    await api
      .post('/experiments')
      .set('Content-Type', apiMediaType)
      .send({
        data: {
          type: 'experiments',
          attributes: { name: 'participant-experiment' },
        },
      })
      .expect(403);
  });

  it('prevents duplicate experiment names', async ({
    hostSession: { api },
  }) => {
    const experimentName = `unique-experiment`;

    // Create first experiment
    await api
      .post('/experiments')
      .set('Content-Type', apiMediaType)
      .send({
        data: { type: 'experiments', attributes: { name: experimentName } },
      })
      .expect(201);

    // Try to create experiment with same name
    await api
      .post('/experiments')
      .set('Content-Type', apiMediaType)
      .send({
        data: { type: 'experiments', attributes: { name: experimentName } },
      })
      .expect(409);
  });
});

describe('Integration - Run Management', () => {
  // Create a fixture with experiment pre-created
  const it = baseTest.extend<{
    hostSession: FixtureContext & { experimentId: string };
    participantSession: FixtureContext & { experimentId: string };
  }>({
    hostSession: async ({ hostSession }, use) => {
      const experimentName = `run-test-experiment`;
      const createResponse = await hostSession.api
        .post('/experiments')
        .set('Content-Type', apiMediaType)
        .send({
          data: { type: 'experiments', attributes: { name: experimentName } },
        })
        .expect(201);

      const experimentId = createResponse.body.data.id;
      await use({ ...hostSession, experimentId });
    },
    participantSession: async ({ participantSession, hostSession }, use) => {
      const experimentId = hostSession.experimentId;
      await use({ ...participantSession, experimentId });
    },
  });

  it('creates, updates and retrieves runs', async ({
    hostSession: { api, experimentId },
  }) => {
    // Create run
    const runName = `test-run`;
    const createResponse = await api
      .post('/runs')
      .set('Content-Type', apiMediaType)
      .send({
        data: {
          type: 'runs',
          attributes: { name: runName, status: 'idle' },
          relationships: {
            experiment: { data: { type: 'experiments', id: experimentId } },
          },
        },
      })
      .expect(201)
      .expect('Content-Type', apiContentTypeRegExp);

    const runId = createResponse.body.data.id;
    expect(runId).toBeDefined();

    // Get run
    const getResponse = await api
      .get(`/runs/${runId}`)
      .expect(200)
      .expect('Content-Type', apiContentTypeRegExp);

    expect(getResponse.body.data.attributes.name).toBe(runName);
    expect(getResponse.body.data.attributes.status).toBe('idle');

    // Update run status
    await api
      .patch(`/runs/${runId}`)
      .set('Content-Type', apiMediaType)
      .send({
        data: { id: runId, type: 'runs', attributes: { status: 'running' } },
      })
      .expect(200);

    // Verify status update
    const updatedResponse = await api.get(`/runs/${runId}`).expect(200);

    expect(updatedResponse.body.data.attributes.status).toBe('running');
    expect(updatedResponse.body).toMatchSnapshot();
  });

  it('adds run to participant session', async ({
    participantSession: { api, experimentId },
  }) => {
    // Create run
    const createResponse = await api
      .post('/runs')
      .set('Content-Type', apiMediaType)
      .send({
        data: {
          type: 'runs',
          attributes: { name: `session-test-run`, status: 'idle' },
          relationships: {
            experiment: { data: { type: 'experiments', id: experimentId } },
          },
        },
      })
      .expect(201);

    const runId = createResponse.body.data.id;
    expect(runId).toBeDefined();

    // Now participant should have access
    const runResponse = await api.get(`/runs/${runId}`).expect(200);

    expect(runResponse.body.data.id).toBe(runId);
    expect(runResponse.body).toMatchSnapshot();
  });
});

describe('Integration - Logging Flow', () => {
  // Create a fixture with experiment and run pre-created
  const it = baseTest.extend<{
    hostSession: FixtureContext & { experimentId: string; runId: string };
    participantSession: FixtureContext & {
      experimentId: string;
      runId: string;
    };
  }>({
    hostSession: async ({ hostSession }, use) => {
      // Create experiment
      const experimentName = `log-test-experiment`;
      const experimentResponse = await hostSession.api
        .post('/experiments')
        .set('Content-Type', apiMediaType)
        .send({
          data: { type: 'experiments', attributes: { name: experimentName } },
        })
        .expect(201);

      const experimentId = experimentResponse.body.data.id;

      // Create run
      const runName = `log-test-host-run`;
      const runResponse = await hostSession.api
        .post('/runs')
        .set('Content-Type', apiMediaType)
        .send({
          data: {
            type: 'runs',
            attributes: { name: runName, status: 'running' },
            relationships: {
              experiment: { data: { type: 'experiments', id: experimentId } },
            },
          },
        })
        .expect(201);

      const runId = runResponse.body.data.id;
      expect(runId).toBeTypeOf('string');

      await use({ ...hostSession, experimentId, runId });
    },
    participantSession: async ({ participantSession, hostSession }, use) => {
      const experimentId = hostSession.experimentId;
      const runName = `log-test-participant-run`;

      // Add run to participant's session
      const resp = await participantSession.api
        .post('/runs')
        .set('Content-Type', apiMediaType)
        .send({
          data: {
            type: 'runs',
            attributes: { name: runName, status: 'running' },
            relationships: {
              experiment: { data: { type: 'experiments', id: experimentId } },
            },
          },
        })
        .expect(201);

      const runId = resp.body.data.id;
      expect(runId).toBeTypeOf('string');

      await use({
        ...participantSession,
        experimentId: hostSession.experimentId,
        runId,
      });
    },
  });

  it('creates and retrieves logs', async ({
    participantSession: { api, runId },
  }) => {
    // Add logs
    await api
      .post(`/logs`)
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

    await api
      .post(`/logs`)
      .set('Content-Type', apiMediaType)
      .send({
        data: {
          type: 'logs',
          attributes: { number: 2, logType: 'test', values: { x: 'y' } },
          relationships: { run: { data: { type: 'runs', id: runId } } },
        },
      })
      .expect(201)
      .expect('Content-Type', apiContentTypeRegExp);

    // Get logs
    const logsResponse = await api.get(`/logs`).expect(200);

    expect(logsResponse.text).toMatchInlineSnapshot(`
      "type,experiment_name,run_name,run_status,x
      test,log-test-experiment,log-test-participant-run,running,x
      test,log-test-experiment,log-test-participant-run,running,y
      "
    `);
  });

  it('filters logs by type', async ({ participantSession: { api, runId } }) => {
    // Add logs of different types

    async function postLog(logType: string, number: number, values: object) {
      return api
        .post(`/logs`)
        .set('Content-Type', apiMediaType)
        .send({
          data: {
            type: 'logs',
            attributes: { number, logType, values },
            relationships: { run: { data: { type: 'runs', id: runId } } },
          },
        })
        .expect(201);
    }

    await postLog('click', 1, { clickValue: 'x' });
    await postLog('move', 2, { moveValue: 'y' });
    await postLog('click', 3, { clickValue: 'z' });

    // Get filtered logs
    const logsResponse = await api
      .get(`/logs?filter[logType]=click`)
      .expect(200);

    expect(logsResponse.text).toMatchInlineSnapshot(`
      "experiment_name,run_name,run_status,click_value
      log-test-experiment,log-test-participant-run,running,x
      log-test-experiment,log-test-participant-run,running,z
      "
    `);
  });

  it('handles complex log value types', async ({
    participantSession: { api, runId },
  }) => {
    // Add log with complex values
    await api
      .post(`/logs`)
      .set('Content-Type', apiMediaType)
      .send({
        data: {
          type: 'logs',
          relationships: { run: { data: { type: 'runs', id: runId } } },
          attributes: {
            number: 1,
            logType: 'complex',
            values: {
              nested: { a: 1, b: 'string' },
              array: [1, 2, 3],
              object_array: [{ id: 1 }, { id: 2 }],
              null_value: null,
              boolean: true,
            },
          },
        },
      })
      .expect(201);

    // Get log and verify complex structure
    const logsResponse = await api
      .get(`/logs`)
      .set('Accept', apiMediaType)
      .expect(200);
    expect(logsResponse.body).toMatchSnapshot();
  });

  it('tests run resumption with logs', async ({
    hostSession: { api, runId },
  }) => {
    // Add initial logs
    // Log 1
    await api
      .post(`/logs`)
      .set('Content-Type', apiMediaType)
      .send({
        data: {
          type: 'logs',
          attributes: { number: 1, logType: 'test', values: { value: 'log1' } },
          relationships: { run: { data: { type: 'runs', id: runId } } },
        },
      })
      .expect(201);

    // Log 2
    await api
      .post(`/logs`)
      .set('Content-Type', apiMediaType)
      .send({
        data: {
          type: 'logs',
          attributes: { number: 2, logType: 'test', values: { value: 'log2' } },
          relationships: { run: { data: { type: 'runs', id: runId } } },
        },
      })
      .expect(201);

    // Log 3
    await api
      .post(`/logs`)
      .set('Content-Type', apiMediaType)
      .send({
        data: {
          type: 'logs',
          attributes: { number: 3, logType: 'test', values: { value: 'log3' } },
          relationships: { run: { data: { type: 'runs', id: runId } } },
        },
      })
      .expect(201);

    let response = await api.get(`/logs`).expect(200);
    expect(response.text).toMatchInlineSnapshot(`
      "type,experiment_name,run_name,run_status,value
      test,log-test-experiment,log-test-host-run,running,log1
      test,log-test-experiment,log-test-host-run,running,log2
      test,log-test-experiment,log-test-host-run,running,log3
      "
    `);

    // Set run to interrupted
    await api
      .patch(`/runs/${runId}`)
      .set('Content-Type', apiMediaType)
      .send({
        data: {
          id: runId,
          type: 'runs',
          attributes: { status: 'interrupted' },
        },
      })
      .expect(200);

    // Resume from log 2
    await api
      .patch(`/runs/${runId}`)
      .set('Content-Type', apiMediaType)
      .send({
        data: {
          id: runId,
          type: 'runs',
          attributes: { status: 'running', lastLogNumber: 2 },
        },
      })
      .expect(200);

    // Add new log that should replace log 3
    await api
      .post(`/logs`)
      .set('Content-Type', apiMediaType)
      .send({
        data: {
          type: 'logs',
          attributes: {
            number: 3,
            logType: 'test',
            values: { value: 'log3-replaced' },
          },
          relationships: { run: { data: { type: 'runs', id: runId } } },
        },
      })
      .expect(201);

    // Verify logs
    response = await api.get(`/logs`).expect(200);
    expect(response.text).toMatchInlineSnapshot(`
      "type,experiment_name,run_name,run_status,value
      test,log-test-experiment,log-test-host-run,running,log1
      test,log-test-experiment,log-test-host-run,running,log2
      test,log-test-experiment,log-test-host-run,running,log3-replaced
      "
    `);
  });
});
