/* eslint-disable no-empty-pattern */
import express from 'express';
import type { Store as SessionStore } from 'express-session';
import { prop, sortBy } from 'remeda';
import request from 'supertest';
import { test as baseTest, beforeEach, describe, vi } from 'vitest';
import { apiMediaType } from '../src/app-utils.ts';
import type { DataStore, ExperimentId, RunStatus } from '../src/data-store.ts';
import { fromAsync } from '../src/utils.ts';
import {
  addRunToSession,
  apiContentTypeRegExp,
  createServerContext,
  generateCombinations,
  host,
  runStatus,
  storeTypes,
  type WithMockedMethods,
} from './test-utils.ts';

interface Fixture {
  context: {
    api: request.Agent;
    sessionStore: WithMockedMethods<SessionStore>;
    dataStore: WithMockedMethods<DataStore>;
    experimentId: ExperimentId;
  };
}
const suite = storeTypes
  .flatMap((storeType) => [
    { storeType, sessionType: 'participant' as const },
    { storeType, sessionType: 'host' as const },
  ])
  .map(({ storeType, sessionType }) => {
    const test = baseTest.extend<Fixture>({
      context: async ({}, use) => {
        const { server, dataStore, sessionStore } = await createServerContext({
          type: storeType,
        });
        const app = express();
        app.use(server.middleware);
        const api = request.agent(app).host(host);
        await api
          .post('/sessions')
          .set('content-type', apiMediaType)
          .send({
            data: { type: 'sessions', attributes: { role: sessionType } },
          })
          .expect(201);
        const { experimentId } = await dataStore.addExperiment({
          experimentName: 'my-experiment-name',
        });
        await use({ dataStore, sessionStore, api, experimentId });
      },
    });
    return { storeType, sessionType, test };
  });
const describeForAll = describe.for(suite);

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ now: new Date('2025-01-01T00:00:00Z'), toFake: ['Date'] });
});

describeForAll(
  'LogServer: post /runs ($sessionType / $storeType)',
  ({ test: it }) => {
    it.for([{ hasAName: true }, { hasAName: false }])(
      'creates a run (with a name: $hasAName)',
      async (
        { hasAName },
        { expect, context: { api, dataStore, experimentId } },
      ) => {
        const response = await api
          .post('/runs')
          .set('content-type', apiMediaType)
          .send({
            data: {
              type: 'runs',
              attributes: {
                name: hasAName ? 'addRun:runName' : null,
                status: 'idle',
              },
              relationships: {
                experiment: { data: { type: 'experiments', id: experimentId } },
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
        await expect(dataStore.getRuns()).resolves.toMatchObject([
          {
            experimentId,
            runId: response.body.data.id,
            runName: hasAName ? 'addRun:runName' : null,
            runStatus: 'idle',
          },
        ]);
        const sessionRequest = await api.get('/sessions/current').expect(200);
        expect(sessionRequest.body.data.relationships.runs.data).toEqual([
          { id: response.body.data.id, type: 'runs' },
        ]);
      },
    );

    it('refuses to create a run if participant already has one running', async ({
      context: { api, experimentId },
    }) => {
      await api
        .post('/runs')
        .set('content-type', apiMediaType)
        .send({
          data: {
            type: 'runs',
            attributes: { status: 'running', name: null },
            relationships: {
              experiment: { data: { type: 'experiments', id: experimentId } },
            },
          },
        })
        .expect(201);
      await api
        .post('/runs')
        .set('content-type', apiMediaType)
        .send({
          data: {
            type: 'runs',
            attributes: { status: 'idle', name: null },
            relationships: {
              experiment: { data: { type: 'experiments', id: experimentId } },
            },
          },
        })
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
    });

    it('refuses to create a run if a run with this name already exists for this experiment', async ({
      context: { api, dataStore, experimentId },
    }) => {
      await dataStore.addRun({ runName: 'test-run', experimentId });
      await api
        .post('/runs')
        .send({
          data: {
            type: 'runs',
            attributes: { status: 'completed', name: 'test-run' },
            relationships: {
              experiment: { data: { type: 'experiments', id: experimentId } },
            },
          },
        })
        .set('content-type', apiMediaType)
        .expect(409, {
          errors: [
            {
              status: 'Conflict',
              code: 'RUN_EXISTS',
              detail: `A run named test-run already exists for experiment ${experimentId}`,
            },
          ],
        })
        .expect('Content-Type', apiContentTypeRegExp);
    });
  },
);

describeForAll(
  'LogServer: get /runs/:run ($sessionType / $storeType)',
  ({ test: it, sessionType }) => {
    it('returns a 404 error if the run does not exist', async ({
      context: { api },
    }) => {
      await api
        .get('/runs/does-not-exist')
        .expect(404, {
          errors: [
            {
              status: 'Not Found',
              code: 'RUN_NOT_FOUND',
              detail: 'Run "does-not-exist" not found',
            },
          ],
        })
        .expect('Content-Type', apiContentTypeRegExp);
    });
    if (sessionType === 'participant') {
      it("returns a 404 error to participants if they don't have access to the run", async ({
        context: { api, dataStore, experimentId },
      }) => {
        const { runId } = await dataStore.addRun({
          runName: 'my-run-name',
          experimentId: experimentId,
        });
        await api
          .get(`/runs/${runId}`)
          .expect(404, {
            errors: [
              {
                status: 'Not Found',
                code: 'RUN_NOT_FOUND',
                detail: `Run "${runId}" not found`,
              },
            ],
          })
          .expect('Content-Type', apiContentTypeRegExp);
      });
    } else {
      it('returns a run to hosts even if it is not theirs', async ({
        context: { api, dataStore, experimentId },
      }) => {
        const { runId } = await dataStore.addRun({
          runName: 'my-run-name',
          experimentId: experimentId,
        });
        await api.get(`/runs/${runId}`).expect(200);
      });
    }

    it('returns a run if client has access to it', async ({
      context: { api, dataStore, sessionStore, experimentId },
      expect,
    }) => {
      const { runId } = await dataStore.addRun({
        runName: 'run-name',
        runStatus: 'running',
        experimentId,
      });
      const logs = await dataStore.addLogs(runId, [
        { type: 'log-type-1', number: 1, values: {} },
        { type: 'log-type-3', number: 2, values: { p3: 'v3' } },
        { type: 'log-type-2', number: 3, values: {} },
        { type: 'log-type-1', number: 4, values: { p1: 'v1' } },
        { type: 'log-type-2', number: 5, values: {} },
        { type: 'log-type-2', number: 6, values: {} },
        { type: 'log-type-2', number: 7, values: {} },
        { type: 'log-type-2', number: 8, values: { p2: 'v2' } },
      ]);
      await addRunToSession({ api, sessionStore, runId });
      const { body } = await api
        .get(`/runs/${runId}`)
        .expect(200)
        .expect('Content-Type', apiContentTypeRegExp);
      expect(body).toEqual({
        data: {
          id: runId,
          type: 'runs',
          attributes: { name: 'run-name', status: 'running', lastLogNumber: 8 },
          relationships: {
            lastLogs: { data: expect.any(Array) },
            experiment: { data: { id: experimentId, type: 'experiments' } },
          },
        },
      });
      expect(sortBy(body.data.relationships.lastLogs.data, prop('id'))).toEqual(
        sortBy(
          [
            { id: logs[3]!.logId, type: 'logs' },
            { id: logs[7]!.logId, type: 'logs' },
            { id: logs[1]!.logId, type: 'logs' },
          ],
          prop('id'),
        ),
      );
    });

    it('returns a run with no name', async ({
      context: { api, dataStore, experimentId, sessionStore },
      expect,
    }) => {
      const { runId } = await dataStore.addRun({
        experimentId,
        runStatus: 'running',
        runName: null,
      });
      const logs = await dataStore.addLogs(runId, [
        { type: 'log-type', number: 1, values: {} },
        { type: 'log-type', number: 2, values: {} },
      ]);
      await addRunToSession({ api, sessionStore, runId });
      const { body } = await api
        .get(`/runs/${runId}`)
        .expect(200)
        .expect('Content-Type', apiContentTypeRegExp);
      expect(body).toEqual({
        data: {
          id: runId,
          type: 'runs',
          attributes: { status: 'running', lastLogNumber: 2, name: null },
          relationships: {
            lastLogs: { data: [{ id: logs[1]?.logId, type: 'logs' }] },
            experiment: { data: { id: experimentId, type: 'experiments' } },
          },
        },
      });
    });
  },
);

describeForAll(
  'LogServer: patch /runs/:run ($sessionType / $storeType)',
  ({ test: it, sessionType }) => {
    it('returns a 404 error if the client tries to change the status of the run that does not exist', async ({
      context: { api },
    }) => {
      await api
        .patch('/runs/does-not-exist')
        .set('content-type', apiMediaType)
        .send({
          data: {
            id: 'does-not-exist',
            type: 'runs',
            attributes: { status: 'completed', name: null },
          },
        })
        .expect(404);
    });

    if (sessionType === 'participant') {
      it('returns a 404 error if a participant tries to change the status of the run but does not have access to that run', async ({
        context: { api, dataStore, experimentId, sessionStore },
      }) => {
        const { runId: otherRunId } = await dataStore.addRun({
          experimentId,
          runName: null,
        });
        await addRunToSession({ api, runId: otherRunId, sessionStore });
        const { runId } = await dataStore.addRun({
          experimentId,
          runName: null,
        });
        await api
          .patch(`/runs/${runId}`)
          .set('content-type', apiMediaType)
          .send({
            data: {
              id: runId,
              type: 'runs',
              attributes: { status: 'completed' },
            },
          })
          .expect(404);
      });

      it('returns a 404 error if a participant tries to resume a run but does not have access to that run', async ({
        context: { api, dataStore, experimentId, sessionStore },
      }) => {
        const { runId: otherRunId } = await dataStore.addRun({
          experimentId,
          runName: null,
        });
        await addRunToSession({ api, runId: otherRunId, sessionStore });
        const { runId } = await dataStore.addRun({
          experimentId,
          runName: null,
        });
        await api
          .patch(`/runs/${runId}`)
          .set('content-type', apiMediaType)
          .send({
            data: {
              id: runId,
              type: 'runs',
              attributes: { lastLogNumber: 10, status: 'running' },
            },
          })
          .expect(404);
      });
    }

    const allowedTransitions = [
      { originalStatus: 'idle', targetStatus: 'running' },
      { originalStatus: 'idle', targetStatus: 'canceled' },
      { originalStatus: 'running', targetStatus: 'canceled' },
      { originalStatus: 'running', targetStatus: 'completed' },
      { originalStatus: 'running', targetStatus: 'interrupted' },
      { originalStatus: 'interrupted', targetStatus: 'running' },
      { originalStatus: 'interrupted', targetStatus: 'canceled' },
      { originalStatus: 'completed', targetStatus: 'canceled' },
    ] as const satisfies Array<{
      originalStatus: RunStatus;
      targetStatus: RunStatus;
    }>;

    it.for(allowedTransitions)(
      'changes the status of a run from $originalStatus to $targetStatus',
      async (
        { originalStatus, targetStatus },
        { expect, context: { api, dataStore, experimentId, sessionStore } },
      ) => {
        const { runId } = await dataStore.addRun({
          experimentId,
          runStatus: originalStatus,
          runName: null,
        });
        await addRunToSession({ api, runId, sessionStore });
        await api
          .patch(`/runs/${runId}`)
          .set('content-type', apiMediaType)
          .send({
            data: {
              id: runId,
              type: 'runs',
              attributes: { status: targetStatus },
            },
          })
          .expect(200);
        const [runRecord] = await dataStore.getRuns({ runId });
        expect(runRecord!.runStatus).toBe(targetStatus);
      },
    );

    const forbiddenTransitions: Array<{
      originalStatus: RunStatus;
      targetStatus: RunStatus;
    }> = generateCombinations(runStatus)
      .map(([originalStatus, targetStatus]) => ({
        originalStatus,
        targetStatus,
      }))
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
        { expect, context: { api, dataStore, experimentId, sessionStore } },
      ) => {
        const { runId } = await dataStore.addRun({
          experimentId,
          runStatus: originalStatus,
        });
        await addRunToSession({ api, runId, sessionStore });
        await api
          .patch(`/runs/${runId}`)
          .set('content-type', apiMediaType)
          .send({
            data: {
              id: runId,
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
        const [runRecord] = await dataStore.getRuns({ runId });
        expect(runRecord!.runStatus).toBe(originalStatus);
      },
    );

    it('accepts but does nothing when nothing to change is requested', async ({
      expect,
      context: { api, dataStore, experimentId, sessionStore },
    }) => {
      const runRecord = await dataStore.addRun({ experimentId });
      await addRunToSession({ api, runId: runRecord.runId, sessionStore });
      await api
        .patch(`/runs/${runRecord.runId}`)
        .set('content-type', apiMediaType)
        .send({ data: { id: runRecord.runId, type: 'runs' } })
        .expect(200);
      const [r1] = await dataStore.getRuns({ runId: runRecord.runId });
      expect(r1).toEqual(runRecord);
      await api
        .patch(`/runs/${runRecord.runId}`)
        .set('content-type', apiMediaType)
        .send({ data: { id: runRecord.runId, type: 'runs', attributes: {} } })
        .expect(200);
      const [r2] = await dataStore.getRuns({ runId: runRecord.runId });
      expect(r2).toEqual(runRecord);
    });

    it.for([
      'canceled',
      'completed',
      'interrupted',
      'idle',
      'running',
    ] satisfies Array<RunStatus>)(
      "accepts but does nothing when asked to change the status of a run to '%s' and it is already the case",
      async (
        status,
        { expect, context: { api, dataStore, sessionStore, experimentId } },
      ) => {
        const runRecord = await dataStore.addRun({
          experimentId,
          runStatus: status,
        });
        await addRunToSession({ api, runId: runRecord.runId, sessionStore });
        await api
          .patch(`/runs/${runRecord.runId}`)
          .set('content-type', apiMediaType)
          .send({
            data: { id: runRecord.runId, type: 'runs', attributes: { status } },
          })
          .expect(200);
        const [r1] = await dataStore.getRuns({ runId: runRecord.runId });
        expect(r1).toEqual(runRecord);
      },
    );

    it('refuses to complete a run if there are pending logs', async ({
      expect,
      context: { api, dataStore, sessionStore, experimentId },
    }) => {
      const runRecord = await dataStore.addRun({
        experimentId,
        runStatus: 'running',
      });
      await dataStore.addLogs(runRecord.runId, [
        { type: 'log-type', number: 1, values: {} },
        // Log with number 2 is missing, so there are pending logs.
        { type: 'log-type', number: 3, values: {} },
      ]);
      await addRunToSession({ api, runId: runRecord.runId, sessionStore });
      await api
        .patch(`/runs/${runRecord.runId}`)
        .set('content-type', apiMediaType)
        .send({
          data: {
            id: runRecord.runId,
            type: 'runs',
            attributes: { status: 'completed' },
          },
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
      const [r1] = await dataStore.getRuns({ runId: runRecord.runId });
      expect(r1).toEqual(runRecord);
    });

    it('updates logs according to lastLogNumber when resuming', async ({
      expect,
      context: { api, experimentId, dataStore, sessionStore },
    }) => {
      const { runId } = await dataStore.addRun({
        experimentId,
        runStatus: 'running',
      });
      await dataStore.addLogs(runId, [
        { type: 'log-type', number: 1, values: { v: 1 } },
        { type: 'log-type', number: 2, values: { v: 2 } },
        { type: 'log-type', number: 3, values: { v: 3 } },
        // Log with number 4 is missing, so there are pending logs.
        { type: 'log-type', number: 6, values: { v: 6 } },
        { type: 'log-type', number: 7, values: { v: 7 } },
      ]);
      await addRunToSession({ api, runId: runId, sessionStore });
      await api
        .patch(`/runs/${runId}`)
        .set('content-type', apiMediaType)
        .send({
          data: { id: runId, type: 'runs', attributes: { lastLogNumber: 2 } },
        })
        .expect(200);
      await expect(dataStore.getRuns({ runId })).resolves.toMatchObject([
        { runId: runId, runName: null, runStatus: 'running' },
      ]);
      await expect(
        fromAsync(dataStore.getLogs({ runId })),
      ).resolves.toMatchObject([
        { number: 1, values: { v: 1 } },
        { number: 2, values: { v: 2 } },
      ]);
    });

    it.for(['idle', 'canceled', 'completed', 'interrupted'] as RunStatus[])(
      "refuses to change lastLogNumber when status is '%s' and unchanged",
      async (
        status,
        { expect, context: { api, dataStore, experimentId, sessionStore } },
      ) => {
        const { runId } = await dataStore.addRun({
          experimentId,
          runStatus: 'running',
        });
        await dataStore.addLogs(runId, [
          { type: 'log-type', number: 1, values: { v: 'v1' } },
          { type: 'log-type', number: 2, values: { v: 'v2' } },
          { type: 'log-type', number: 3, values: { v: 'v3' } },
        ]);
        await dataStore.setRunStatus(runId, status);
        await addRunToSession({ api, runId, sessionStore });
        await api
          .patch(`/runs/${runId}`)
          .set('content-type', apiMediaType)
          .send({
            data: { id: runId, type: 'runs', attributes: { lastLogNumber: 1 } },
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
        await expect(dataStore.getRuns({ runId })).resolves.toMatchObject([
          { runId: runId, runName: null, runStatus: status },
        ]);
        await expect(
          fromAsync(dataStore.getLogs({ runId })),
        ).resolves.toMatchObject([
          { number: 1, values: { v: 'v1' } },
          { number: 2, values: { v: 'v2' } },
          { number: 3, values: { v: 'v3' } },
        ]);
      },
    );

    it("resumes an interrupted run if lastLogNumber has changed and new status is 'running'", async ({
      expect,
      context: { api, experimentId, dataStore, sessionStore },
    }) => {
      const { runId } = await dataStore.addRun({
        experimentId,
        runStatus: 'running',
      });
      await dataStore.addLogs(runId, [
        { type: 'log-type', number: 1, values: { v: 'v1' } },
        { type: 'log-type', number: 2, values: { v: 'v2' } },
        { type: 'log-type', number: 3, values: { v: 'v3' } },
      ]);
      await dataStore.setRunStatus(runId, 'interrupted');
      await addRunToSession({ api, runId, sessionStore });
      await api
        .patch(`/runs/${runId}`)
        .set('content-type', apiMediaType)
        .send({
          data: {
            id: runId,
            type: 'runs',
            attributes: { status: 'running', lastLogNumber: 1 },
          },
        })
        .expect(200);
      await expect(dataStore.getRuns({ runId })).resolves.toMatchObject([
        { runId: runId, runName: null, runStatus: 'running' },
      ]);
      await expect(
        fromAsync(dataStore.getLogs({ runId })),
      ).resolves.toMatchObject([{ number: 1, values: { v: 'v1' } }]);
    });
  },
);

describeForAll(
  'LogServer: get /runs ($sessionType / $storeType)',
  ({ test: it, sessionType }) => {
    it(
      sessionType === 'host'
        ? 'returns a 200 with all runs'
        : 'returns a 200 with participant-owned runs',
      async ({
        expect,
        context: { api, dataStore, sessionStore, experimentId },
      }) => {
        const baseRunOptions = { experimentId, runStatus: 'running' as const };
        const { runId: r1 } = await dataStore.addRun({
          ...baseRunOptions,
          runName: 'run-1',
        });
        await dataStore.addLogs(r1, [
          { type: 'log-type', number: 1, values: { v: 'r1l1' } },
          { type: 'log-type', number: 2, values: { v: 'r1l2' } },
        ]);
        const { runId: r2 } = await dataStore.addRun({
          ...baseRunOptions,
          runName: 'run-2',
        });
        await dataStore.addLogs(r2, [
          { type: 'log-type', number: 1, values: { v: 'r2l1' } },
        ]);
        await addRunToSession({ api, sessionStore, runId: r1 });
        const response = await api
          .get('/runs')
          .expect(200)
          .expect('Content-Type', apiContentTypeRegExp);
        expect(response.body).toMatchSnapshot();
      },
    );

    async function setup3runsIn2experiments(dataStore: DataStore) {
      const { experimentId: e1 } = await dataStore.addExperiment({
        experimentName: 'experiment-1',
      });
      const { runId: r1 } = await dataStore.addRun({
        experimentId: e1,
        runStatus: 'running',
        runName: 'run-1',
      });
      await dataStore.addLogs(r1, [
        { type: 'log-type', number: 1, values: { v: 'r1l1' } },
        { type: 'log-type', number: 2, values: { v: 'r1l2' } },
      ]);
      const { runId: r2 } = await dataStore.addRun({
        experimentId: e1,
        runStatus: 'completed',
        runName: 'run-2',
      });
      const { experimentId: e2 } = await dataStore.addExperiment({
        experimentName: 'experiment-2',
      });
      const { runId: r3 } = await dataStore.addRun({
        experimentId: e2,
        runStatus: 'running',
      });
      await dataStore.addLogs(r3, [
        { type: 'log-type', number: 1, values: { v: 'r3l1' } },
      ]);
      return {
        experimentIds: [e1, e2] as const,
        runIds: [r1, r2, r3] as const,
      };
    }

    it(
      sessionType === 'host'
        ? 'returns a 200 with all runs with requested related experiment'
        : 'returns a 200 with participant-owned runs with requested related experiment',
      async ({ expect, context: { api, dataStore, sessionStore } }) => {
        const {
          runIds: [r1],
        } = await setup3runsIn2experiments(dataStore);
        await addRunToSession({ api, sessionStore, runId: r1 });
        const response = await api
          .get('/runs')
          .query({ include: 'experiment' })
          .expect(200)
          .expect('Content-Type', apiContentTypeRegExp);
        expect(response.body.included).toHaveLength(
          sessionType === 'host' ? 2 : 1,
        );
        expect(response.body).toMatchSnapshot();
      },
    );

    it(
      sessionType === 'host'
        ? 'returns a 200 with all runs with requested related lastLogs'
        : 'returns a 200 with participant-owned runs with requested related lastLogs',
      async ({ expect, context: { api, dataStore, sessionStore } }) => {
        const {
          runIds: [r1],
        } = await setup3runsIn2experiments(dataStore);
        await addRunToSession({ api, sessionStore, runId: r1 });
        const response = await api
          .get('/runs')
          .query({ include: 'lastLogs' })
          .expect(200)
          .expect('Content-Type', apiContentTypeRegExp);
        expect(response.body.included).toHaveLength(
          sessionType === 'host' ? 2 : 1,
        );
        expect(response.body).toMatchSnapshot();
      },
    );

    it(
      sessionType === 'host'
        ? 'returns a 200 with all runs with requested related lastLogs'
        : 'returns a 200 with participant-owned runs with requested related lastLogs',
      async ({ expect, context: { api, dataStore, sessionStore } }) => {
        const {
          runIds: [r1],
        } = await setup3runsIn2experiments(dataStore);
        await addRunToSession({ api, sessionStore, runId: r1 });
        const response = await api
          .get('/runs')
          .query({ include: ['lastLogs', 'experiment'] })
          .expect(200)
          .expect('Content-Type', apiContentTypeRegExp);
        expect(response.body.included).toHaveLength(
          sessionType === 'host' ? 4 : 2,
        );
        expect(response.body).toMatchSnapshot();
      },
    );

    it('returns a 200 with empty array when no runs found', async ({
      context: { api },
    }) => {
      await api
        .get('/runs')
        .expect(200, { data: [] })
        .expect('Content-Type', apiContentTypeRegExp);
    });
  },
);
