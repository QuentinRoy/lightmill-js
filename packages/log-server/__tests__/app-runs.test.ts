/* eslint-disable no-empty-pattern */

import { describe, vi, test as vitestTest } from 'vitest';
import { apiMediaType } from '../src/app-utils.ts';
import { DataStoreError } from '../src/data-store-errors.ts';
import type { RunStatus } from '../src/data-store.ts';
import { arrayify, firstStrict } from '../src/utils.js';
import {
  apiContentTypeRegExp,
  createFixtureWithRuns,
  generateCombinations,
  runStatus,
  type FixtureWithRuns,
} from './test-utils.js';

const it = vitestTest.extend<Fixture>({
  noRun: async ({}, use) => {
    await use(await createFixtureWithRuns());
  },
  oneRun: async ({}, use) => {
    const context = await createFixtureWithRuns();
    const run = 'my-run-id';
    context.setRuns([
      {
        runId: run,
        runName: 'my-run-name',
        experimentId: context.experiment,
        runStatus: 'running' as const,
        runCreatedAt: vi.getMockedSystemTime() ?? new Date(),
      },
    ]);
    await use({ ...context, run });
  },
});

describe('LogServer: post /runs', () => {
  it('creates a run with a name', async ({
    expect,
    noRun: { api, store, experiment, sessionStore },
  }) => {
    const response = await api
      .post('/runs')
      .set('content-type', apiMediaType)
      .send({
        data: {
          type: 'runs',
          attributes: { name: 'addRun:runName', status: 'idle' },
          relationships: {
            experiment: { data: { type: 'experiments', id: experiment } },
          },
        },
      })
      .expect(201)
      .expect('Content-Type', apiContentTypeRegExp);
    expect(response.headers['location']).toEqual(
      `http://lightmill-test.com/runs/${response.body.data.id}`,
    );
    expect(response.body).toEqual({
      data: { id: expect.any(String), type: 'runs' },
    });
    expect(store.addRun).toHaveBeenCalledWith({
      experimentId: experiment,
      runName: 'addRun:runName',
      runStatus: 'idle',
    });
    expect(sessionStore.set.mock.calls[0]![1].data).toEqual({
      role: 'participant',
      runs: [response.body.data.id],
    });
  });

  it('creates a run without a name', async ({
    expect,
    noRun: { api, store, experiment, sessionStore },
  }) => {
    const response = await api
      .post('/runs')
      .set('content-type', apiMediaType)
      .send({
        data: {
          type: 'runs',
          attributes: { status: 'idle' },
          relationships: {
            experiment: { data: { type: 'experiments', id: experiment } },
          },
        },
      })
      .expect(201)
      .expect('Content-Type', apiContentTypeRegExp);
    expect(response.body).toEqual({
      data: { id: expect.any(String), type: 'runs' },
    });
    expect(store.addRun).toHaveBeenCalledWith({
      experimentId: experiment,
      runStatus: 'idle',
    });
    expect(sessionStore.set.mock.calls[0]![1].data).toEqual({
      role: 'participant',
      runs: [response.body.data.id],
    });
  });

  it('refuses to create a run if participant already has one running', async ({
    expect,
    noRun: { api, store, experiment, sessionStore },
  }) => {
    sessionStore.mockGetData({ role: 'participant', runs: ['999'] });
    store.getRuns.mockImplementation(async (filter) => {
      if (filter?.runId == null || arrayify(filter.runId).includes('999')) {
        return [
          {
            runId: '999',
            runName: 'my-run',
            experimentId: 'exp',
            runStatus: 'running' as const,
            runCreatedAt: new Date('2025-01-01'),
          },
        ];
      }
      return [];
    });
    await api
      .post('/runs')
      .send({
        data: {
          type: 'runs',
          attributes: { status: 'idle' },
          relationships: {
            experiment: { data: { type: 'experiments', id: experiment } },
          },
        },
      })
      .set('content-type', apiMediaType)
      .expect(403, {
        errors: [
          {
            status: 'Forbidden',
            code: 'ONGOING_RUNS',
            detail: 'Client already has ongoing runs, end them first',
          },
        ],
      })
      .expect('Content-Type', apiContentTypeRegExp);
    expect(store.addRun).toHaveBeenCalledTimes(0);
  });

  it('refuses to create a run if a run with this name already exists for this experiment', async ({
    expect,
    noRun: { api, store, experiment },
  }) => {
    store.addRun.mockImplementation(() => {
      throw new DataStoreError('message', DataStoreError.RUN_EXISTS);
    });
    await api
      .post('/runs')
      .send({
        data: {
          type: 'runs',
          attributes: { status: 'completed', name: 'test-run' },
          relationships: {
            experiment: { data: { type: 'experiments', id: experiment } },
          },
        },
      })
      .set('content-type', apiMediaType)
      .expect(409, {
        errors: [
          {
            status: 'Conflict',
            code: 'RUN_EXISTS',
            detail: `A run named test-run already exists for experiment ${experiment}`,
          },
        ],
      })
      .expect('Content-Type', apiContentTypeRegExp);
    expect(store.addRun).toHaveBeenCalledTimes(1);
  });
});

describe('LogServer: get /runs/:run', () => {
  it('returns a 404 error if client does not have access to any run', async ({
    noRun: { api, store },
  }) => {
    store.getRuns.mockImplementation(async () => []);
    await api
      .get('/runs/not-my-run')
      .expect(404, {
        errors: [
          {
            status: 'Not Found',
            code: 'RUN_NOT_FOUND',
            detail: 'Run not-my-run not found',
          },
        ],
      })
      .expect('Content-Type', apiContentTypeRegExp);
  });

  it('returns a 404 error if client does not have access to this particular run', async ({
    noRun: { api, store },
  }) => {
    store.getRuns.mockImplementation(async (filter) => {
      if (arrayify(filter?.runName, true).includes('not-my-run')) {
        return [];
      }
      return [
        {
          runId: '999',
          runName: 'my-run',
          experimentId: 'exp',
          runStatus: 'running' as const,
          runCreatedAt: vi.getMockedSystemTime() ?? new Date(),
        },
      ];
    });
    await api
      .get('/runs/not-my-run')
      .expect(404, {
        errors: [
          {
            status: 'Not Found',
            code: 'RUN_NOT_FOUND',
            detail: 'Run not-my-run not found',
          },
        ],
      })
      .expect('Content-Type', apiContentTypeRegExp);
  });

  it.for([
    { runs: [], role: 'host' as const },
    { runs: ['my-run', 'another-run'], role: 'participant' as const },
  ])(
    'returns a run resource if client has access to it (role: $role, runs: $runs)',
    async (sessionData, { expect, noRun: { api, store, sessionStore } }) => {
      sessionStore.mockGetData(sessionData);
      store.getLastLogs.mockImplementation(async () => [
        {
          logId: 'log-1',
          type: 'log-type-1',
          number: 4,
          createdAt: new Date(),
          values: { p1: 'v1' },
          runId: 'my-run',
        },
        {
          logId: 'log-2',
          type: 'log-type-2',
          number: 8,
          createdAt: new Date(),
          values: { p2: 'v2' },
          runId: 'my-run',
        },
        {
          logId: 'log-3',
          type: 'log-type-3',
          number: 2,
          createdAt: new Date(),
          values: { p3: 'v3' },
          runId: 'my-run',
        },
      ]);
      store.getRuns.mockImplementation(async (filter) => {
        if (
          filter?.runId == null ||
          arrayify(filter?.runId).includes('my-run')
        ) {
          return [
            {
              runId: 'my-run',
              runName: 'run-name',
              experimentId: 'exp-id',
              runStatus: 'running' as const,
              runCreatedAt: vi.getMockedSystemTime() ?? new Date(),
            },
          ];
        }
        return [];
      });
      const resp = await api
        .get('/runs/my-run')
        .expect(200)
        .expect('Content-Type', apiContentTypeRegExp);
      const respBody = resp.body;
      expect(respBody).toEqual({
        data: {
          id: 'my-run',
          type: 'runs',
          attributes: { name: 'run-name', status: 'running', lastLogNumber: 8 },
          relationships: {
            lastLogs: {
              data: [
                { id: 'log-1', type: 'logs' },
                { id: 'log-2', type: 'logs' },
                { id: 'log-3', type: 'logs' },
              ],
            },
            experiment: { data: { id: 'exp-id', type: 'experiments' } },
          },
        },
      });
    },
  );
});

describe('LogServer: patch /runs/:run', () => {
  it('returns a 404 error if the client tries to change the status of the run but does not have access to any run', async ({
    expect,
    noRun: { api, store },
  }) => {
    store.getRuns.mockImplementation(async () => []);
    await api
      .patch('/runs/not-my-run')
      .set('content-type', apiMediaType)
      .send({
        data: {
          id: 'not-my-run',
          type: 'runs',
          attributes: { status: 'completed' },
        },
      })
      .expect(404);
    expect(store.resumeRun).not.toHaveBeenCalled();
    expect(store.setRunStatus).not.toHaveBeenCalled();
  });

  it('returns a 404 error if the client tries to change the status of the run but does not have access to this particular run', async ({
    expect,
    oneRun: { api, store },
  }) => {
    await api
      .patch('/runs/not-my-run')
      .set('content-type', apiMediaType)
      .send({
        data: {
          id: 'not-my-run',
          type: 'runs',
          attributes: { status: 'completed' },
        },
      })
      .expect(404);
    expect(store.setRunStatus).not.toHaveBeenCalled();
    expect(store.resumeRun).not.toHaveBeenCalled();
  });

  it('returns a 404 error if the client tries to resume a run but does not have access to any run', async ({
    expect,
    noRun: { api, store },
  }) => {
    store.getRuns.mockImplementation(async () => []);
    await api
      .patch('/runs/not-my-run')
      .set('content-type', apiMediaType)
      .send({
        data: {
          id: 'not-my-run',
          type: 'runs',
          attributes: { lastLogNumber: 10, status: 'running' },
        },
      })
      .expect(404);
    expect(store.resumeRun).not.toHaveBeenCalled();
    expect(store.setRunStatus).not.toHaveBeenCalled();
  });

  it('returns a 404 error if the client tries to resume a run but does not have access to this particular run', async ({
    expect,
    oneRun: { api, store },
  }) => {
    await api
      .patch('/runs/not-my-run')
      .set('content-type', apiMediaType)
      .send({
        data: {
          id: 'not-my-run',
          type: 'runs',
          attributes: { lastLogNumber: 10, status: 'running' },
        },
      })
      .expect(404);
    expect(store.resumeRun).not.toHaveBeenCalled();
    expect(store.setRunStatus).not.toHaveBeenCalled();
  });

  const allowedTransitions: Array<{
    originalStatus: RunStatus;
    targetStatus: RunStatus;
  }> = [
    { originalStatus: 'idle', targetStatus: 'running' },
    { originalStatus: 'idle', targetStatus: 'canceled' },
    { originalStatus: 'running', targetStatus: 'canceled' },
    { originalStatus: 'running', targetStatus: 'completed' },
    { originalStatus: 'running', targetStatus: 'interrupted' },
    { originalStatus: 'interrupted', targetStatus: 'running' },
    { originalStatus: 'interrupted', targetStatus: 'canceled' },
    { originalStatus: 'completed', targetStatus: 'canceled' },
  ];

  it.for(allowedTransitions)(
    'changes the status of a run from $originalStatus to $targetStatus',
    async (
      { originalStatus, targetStatus },
      { expect, noRun: { api, store, setRuns, experiment } },
    ) => {
      setRuns([
        {
          runId: 'run-id',
          runName: 'run-name',
          experimentId: experiment,
          runStatus: originalStatus,
          runCreatedAt: new Date('2025-01-01T00:00:00Z'),
        },
      ]);
      await api
        .patch(`/runs/run-id`)
        .set('content-type', apiMediaType)
        .send({
          data: {
            id: 'run-id',
            type: 'runs',
            attributes: { status: targetStatus },
          },
        })
        .expect(200);
      expect(store.setRunStatus).toHaveBeenCalledWith('run-id', targetStatus);
      expect(store.resumeRun).not.toHaveBeenCalled();
    },
  );

  const forbiddenTransitions: Array<{
    originalStatus: RunStatus;
    targetStatus: RunStatus;
  }> = generateCombinations(runStatus)
    .map(([originalStatus, targetStatus]) => ({ originalStatus, targetStatus }))
    .filter(
      (t) =>
        t.originalStatus !== t.targetStatus &&
        allowedTransitions.every(
          (t2) =>
            t2.originalStatus !== t.originalStatus ||
            t.targetStatus !== t2.targetStatus,
        ),
    );

  it.for(forbiddenTransitions)(
    'refuses to change the status of a run from $originalStatus to $targetStatus',
    async (
      { originalStatus, targetStatus },
      { expect, noRun: { api, store, setRuns, experiment } },
    ) => {
      setRuns([
        {
          runId: 'run-id',
          runName: 'run-name',
          experimentId: experiment,
          runStatus: originalStatus,
          runCreatedAt: new Date('2025-01-01T00:00:00Z'),
        },
      ]);
      await api
        .patch('/runs/run-id')
        .set('content-type', apiMediaType)
        .send({
          data: {
            id: 'run-id',
            type: 'runs',
            attributes: { status: targetStatus },
          },
        })
        .expect(403, {
          errors: [
            {
              status: 'Forbidden',
              code: 'INVALID_STATUS_TRANSITION',
              detail: `Cannot transition run status from ${originalStatus} to ${targetStatus}`,
            },
          ],
        })
        .expect('Content-Type', apiContentTypeRegExp);
      expect(store.setRunStatus).not.toHaveBeenCalled();
      expect(store.resumeRun).not.toHaveBeenCalled();
    },
  );

  it('accepts but does nothing when nothing to change is requested', async ({
    expect,
    noRun: { api, store, setRuns, experiment },
  }) => {
    setRuns([
      {
        runId: 'run-id',
        runName: 'run-name',
        experimentId: experiment,
        runStatus: 'running',
        runCreatedAt: new Date('2025-01-01T00:00:00Z'),
      },
    ]);
    await api
      .patch(`/runs/run-id`)
      .set('content-type', apiMediaType)
      .send({ data: { id: 'run-id', type: 'runs' } })
      .expect(200);
    await api
      .patch(`/runs/run-id`)
      .set('content-type', apiMediaType)
      .send({ data: { id: 'run-id', type: 'runs', attributes: {} } })
      .expect(200);
    expect(store.setRunStatus).not.toHaveBeenCalled();
    expect(store.resumeRun).not.toHaveBeenCalled();
  });

  it.for([
    'canceled',
    'completed',
    'interrupted',
    'idle',
    'running',
  ] satisfies Array<RunStatus>)(
    "accepts but does nothing when asked to change the status of a run to '%s' and it is already the case",
    async (status, { expect, noRun: { api, store, setRuns, experiment } }) => {
      setRuns([
        {
          runId: 'run-id',
          runName: 'run-name',
          experimentId: experiment,
          runStatus: status,
          runCreatedAt: new Date('2025-01-01T00:00:00Z'),
        },
      ]);
      await api
        .patch(`/runs/run-id`)
        .set('content-type', apiMediaType)
        .send({ data: { id: 'run-id', type: 'runs', attributes: { status } } })
        .expect(200);
      expect(store.setRunStatus).not.toHaveBeenCalled();
      expect(store.resumeRun).not.toHaveBeenCalled();
    },
  );

  it('refuses to complete a run if there are pending logs', async ({
    oneRun: { api, run, store },
    expect,
  }) => {
    store.getNumberOfPendingLogs.mockImplementation(async () => [
      { runId: run, count: 2 },
    ]);
    await api
      .patch(`/runs/${run}`)
      .set('content-type', apiMediaType)
      .send({
        data: { id: run, type: 'runs', attributes: { status: 'completed' } },
      })
      .expect(403, {
        errors: [
          {
            status: 'Forbidden',
            code: 'PENDING_LOGS',
            detail: 'Cannot complete run with pending logs',
          },
        ],
      })
      .expect('Content-Type', apiContentTypeRegExp);
    expect(store.setRunStatus).not.toHaveBeenCalled();
  });

  it('resumes a running run if lastLogNumber has changed', async ({
    expect,
    oneRun: { api, run, store },
  }) => {
    store.getLastLogs.mockImplementation(async () => [
      { runId: run, logId: 'log-id', type: 'log-type', number: 41, values: {} },
    ]);
    await api
      .patch(`/runs/${run}`)
      .set('content-type', apiMediaType)
      .send({
        data: { id: run, type: 'runs', attributes: { lastLogNumber: 15 } },
      })
      .expect(200);
    expect(store.setRunStatus).not.toHaveBeenCalled();
    expect(store.resumeRun).toHaveBeenCalledWith(run, { after: 15 });
  });

  it.for(['idle', 'canceled', 'completed', 'interrupted'] as RunStatus[])(
    "refuses to change lastLogNumber when status is '%s' and unchanged",
    async (status, { expect, noRun: { api, setRuns, store, experiment } }) => {
      setRuns([
        {
          experimentId: experiment,
          runId: 'run-id',
          runName: 'run-name',
          runStatus: status,
          runCreatedAt: new Date(100100),
        },
      ]);
      store.getLastLogs.mockImplementation(async () => [
        {
          runId: 'run-id',
          logId: 'log-id',
          type: 'log-type',
          number: 41,
          values: {},
        },
      ]);
      await api
        .patch(`/runs/run-id`)
        .set('content-type', apiMediaType)
        .send({
          data: {
            id: 'run-id',
            type: 'runs',
            attributes: { lastLogNumber: 15 },
          },
        })
        .expect(403, {
          errors: [
            {
              status: 'Forbidden',
              code: 'INVALID_LAST_LOG_NUMBER',
              detail:
                'Updating last log number is only allowed when resuming a run',
            },
          ],
        })
        .expect('Content-Type', apiContentTypeRegExp);
      expect(store.setRunStatus).not.toHaveBeenCalled();
      expect(store.resumeRun).not.toHaveBeenCalled();
    },
  );

  it("resumes an interrupted run if lastLogNumber has changed and new status is 'running'", async ({
    expect,
    noRun: { api, setRuns, store, experiment },
  }) => {
    setRuns([
      {
        experimentId: experiment,
        runId: 'run-id',
        runName: 'run-name',
        runStatus: 'interrupted',
        runCreatedAt: new Date(100100),
      },
    ]);
    store.getLastLogs.mockImplementation(async () => [
      {
        runId: 'run-id',
        logId: 'log-id',
        type: 'log-type',
        number: 41,
        values: {},
      },
    ]);
    await api
      .patch(`/runs/run-id`)
      .set('content-type', apiMediaType)
      .send({
        data: {
          id: 'run-id',
          type: 'runs',
          attributes: { lastLogNumber: 15, status: 'running' },
        },
      })
      .expect(200);
    expect(store.setRunStatus).not.toHaveBeenCalled();
    expect(store.resumeRun).toHaveBeenCalledWith('run-id', { after: 15 });
  });
});

describe('LogServer: get /runs', () => {
  it('returns a 200 with all runs when authenticated with role host', async ({
    expect,
    noRun: { api, store, sessionStore },
  }) => {
    sessionStore.mockGetData({ role: 'host', runs: [] });
    store.getRuns.mockImplementation(async () => [
      {
        runId: 'run-id-1',
        runName: 'run-name-1',
        experimentId: 'exp-id',
        runStatus: 'running' as const,
        runCreatedAt: vi.getMockedSystemTime() ?? new Date(),
      },
      {
        runId: 'run-id-2',
        runName: 'run-name-2',
        experimentId: 'exp-id',
        runStatus: 'completed' as const,
        runCreatedAt: vi.getMockedSystemTime() ?? new Date(),
      },
    ]);
    store.getLastLogs.mockImplementation(async (filter) => {
      const runId = firstStrict(arrayify(filter?.runId, true));
      return [
        {
          logId: `log-${runId}-1`,
          type: 'log-type',
          number: runId === 'run-id-1' ? 5 : 10,
          createdAt: new Date(),
          values: {},
          runId,
        },
      ];
    });
    const response = await api
      .get('/runs')
      .expect(200)
      .expect('Content-Type', apiContentTypeRegExp);
    expect(response.body).toMatchSnapshot();
    expect(store.getRuns.mock.calls).toMatchSnapshot();
  });

  it('returns a 200 with participant-owned runs when authenticated as participant', async ({
    expect,
    oneRun: { api, store, sessionStore, run },
  }) => {
    sessionStore.mockGetData({ role: 'participant', runs: [run] });
    store.getLastLogs.mockImplementation(async () => [
      {
        logId: `log-${run}-1`,
        type: 'log-type',
        number: 15,
        createdAt: new Date(0),
        values: {},
        runId: run,
      },
    ]);
    const response = await api
      .get('/runs')
      .expect(200)
      .expect('Content-Type', apiContentTypeRegExp);
    expect(response.body).toMatchSnapshot();
    expect(store.getRuns.mock.calls).toMatchSnapshot();
  });

  it('returns a 200 with participant-owned runs when authenticated as participant', async ({
    expect,
    oneRun: { api, store, sessionStore, run },
  }) => {
    sessionStore.mockGetData({ role: 'participant', runs: [run] });
    store.getLastLogs.mockImplementation(async () => [
      {
        logId: `log-${run}-1`,
        type: 'log-type',
        number: 15,
        createdAt: new Date(0),
        values: {},
        runId: run,
      },
    ]);
    const response = await api
      .get('/runs')
      .expect(200)
      .expect('Content-Type', apiContentTypeRegExp);
    expect(response.body).toMatchSnapshot();
    expect(store.getRuns.mock.calls).toMatchSnapshot();
  });

  it('returns a 200 with participant-owned runs and requested related experiment', async ({
    expect,
    oneRun: { api, store, sessionStore, run },
  }) => {
    sessionStore.mockGetData({ role: 'participant', runs: [run] });
    store.getLastLogs.mockImplementation(async () => [
      {
        logId: `log-${run}-1`,
        type: 'log-type',
        number: 15,
        createdAt: new Date(0),
        values: {},
        runId: run,
      },
    ]);
    const response = await api
      .get('/runs')
      .query({ include: 'experiment' })
      .expect(200)
      .expect('Content-Type', apiContentTypeRegExp);
    expect(response.body).toMatchSnapshot();
    expect(store.getRuns.mock.calls).toMatchSnapshot();
  });

  it('returns a 200 with participant-owned runs and requested related lastLogs', async ({
    expect,
    oneRun: { api, store, sessionStore, run },
  }) => {
    sessionStore.mockGetData({ role: 'participant', runs: [run] });
    store.getLastLogs.mockImplementation(async () => [
      {
        logId: `log-${run}-1`,
        type: 'log-type',
        number: 15,
        createdAt: new Date(0),
        values: {},
        runId: run,
      },
    ]);
    const response = await api
      .get('/runs')
      .query({ include: 'lastLogs' })
      .expect(200)
      .expect('Content-Type', apiContentTypeRegExp);
    expect(response.body).toMatchSnapshot();
    expect(store.getRuns.mock.calls).toMatchSnapshot();
  });

  it('returns a 200 with participant-owned runs and requested related lastLogs and experiments', async ({
    expect,
    oneRun: { api, store, sessionStore, run },
  }) => {
    sessionStore.mockGetData({ role: 'participant', runs: [run] });
    store.getLastLogs.mockImplementation(async () => [
      {
        logId: `log-${run}-1`,
        type: 'log-type',
        number: 15,
        createdAt: new Date(0),
        values: {},
        runId: run,
      },
    ]);
    const response = await api
      .get('/runs')
      .query({ include: ['lastLogs', 'experiment'] })
      .expect(200)
      .expect('Content-Type', apiContentTypeRegExp);
    expect(response.body).toMatchSnapshot();
    expect(store.getRuns.mock.calls).toMatchSnapshot();
  });

  it('returns a 200 with empty array when no runs found', async ({
    expect,
    noRun: { api, store, sessionStore },
  }) => {
    sessionStore.mockGetData({ role: 'participant', runs: [] });
    store.getRuns.mockImplementation(async () => []);
    store.getExperiments.mockImplementation(async () => []);
    const response = await api
      .get('/runs')
      .expect(200)
      .expect('Content-Type', apiContentTypeRegExp);
    expect(response.body).toEqual({ data: [] });
    expect(store.getRuns.mock.calls).toMatchSnapshot();
  });
});

type Fixture = {
  noRun: FixtureWithRuns;
  oneRun: FixtureWithRuns & { run: string };
};
