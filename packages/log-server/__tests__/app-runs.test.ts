/* eslint-disable no-empty-pattern */
import { mediaType } from '@lightmill/log-api/vocabulary';
import express from 'express';
import type { Store as SessionStore } from 'express-session';
import { prop, sortBy } from 'remeda';
import request from 'supertest';
import { test as baseTest, beforeEach, describe, vi } from 'vitest';
import type { DataStore, ExperimentId, RunStatus } from '../src/data-store.ts';
import { fromAsync } from '../src/utils.ts';
import {
  addRunToSession,
  apiContentTypeRegExp,
  createRunRequest,
  createServerContext,
  host,
  listen,
  storeTypes,
  type MockedDataStore,
  type WithMockedMethods,
} from './__fixtures__/test-utils.ts';

interface Fixture {
  context: {
    api: request.Agent;
    sessionStore: WithMockedMethods<SessionStore>;
    dataStore: MockedDataStore;
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
        const api = request.agent(await listen(app)).host(host);
        await api
          .post('/sessions')
          .set('content-type', mediaType)
          .send({
            data: { type: 'sessions', attributes: { role: sessionType } },
          })
          .expect(201);
        const { experimentId } = await dataStore.withTransaction((tx) =>
          tx.addExperiment({ experimentName: 'my-experiment-name' }),
        );
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
  'createLogServer: post /runs ($sessionType / $storeType)',
  ({ test: it }) => {
    it.for([{ hasAName: true }, { hasAName: false }])(
      'creates a run (with a name: $hasAName)',
      async (
        { hasAName },
        { expect, context: { api, dataStore, experimentId } },
      ) => {
        const response = await api
          .post('/runs')
          .set('content-type', mediaType)
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

    const ongoingStatuses: RunStatus[] = ['idle', 'running', 'interrupted'];
    const endedStatuses: RunStatus[] = ['completed', 'canceled'];
    it.for(
      ongoingStatuses.flatMap((existing) =>
        (['idle', 'running'] as const).map((created) => ({
          existing,
          created,
        })),
      ),
    )(
      'refuses to create a $created run if the session has a run that is $existing',
      async (
        { existing, created },
        { context: { api, dataStore, experimentId, sessionStore } },
      ) => {
        const { runId } = await dataStore.withTransaction((tx) =>
          tx.addRun({ experimentId, runStatus: existing }),
        );
        await addRunToSession({ api, runId, sessionStore });
        await createRunRequest(api, experimentId, created)
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
      },
    );

    it.for(endedStatuses)(
      'creates a run if the only run of the session is %s',
      async (
        existing,
        { context: { api, dataStore, experimentId, sessionStore } },
      ) => {
        const { runId } = await dataStore.withTransaction((tx) =>
          tx.addRun({ experimentId, runStatus: existing }),
        );
        await addRunToSession({ api, runId, sessionStore });
        await createRunRequest(api, experimentId, 'idle').expect(201);
      },
    );

    it('ignores the runs that are not in the session', async ({
      context: { api, dataStore, experimentId },
    }) => {
      await dataStore.withTransaction((tx) =>
        tx.addRun({ experimentId, runStatus: 'running' }),
      );
      await createRunRequest(api, experimentId, 'idle').expect(201);
    });

    it.for(['completed', 'canceled', 'interrupted'] as const)(
      'refuses to create a run with the status %s',
      async (status, { expect, context: { api, dataStore, experimentId } }) => {
        await api
          .post('/runs')
          .set('content-type', mediaType)
          .send({
            data: {
              type: 'runs',
              attributes: { status, name: null },
              relationships: {
                experiment: { data: { type: 'experiments', id: experimentId } },
              },
            },
          })
          .expect(403, {
            errors: [
              {
                status: 'Forbidden',
                code: 'INVALID_RUN_STATUS',
                detail: `Cannot create a run with status ${status}. A run is created idle or running.`,
              },
            ],
          })
          .expect('Content-Type', apiContentTypeRegExp);
        await expect(dataStore.getRuns()).resolves.toEqual([]);
      },
    );

    it('returns an error if the experiment does not exist', async ({
      context: { api },
    }) => {
      await api
        .post('/runs')
        .set('content-type', mediaType)
        .send({
          data: {
            type: 'runs',
            attributes: { status: 'idle', name: null },
            relationships: {
              experiment: { data: { type: 'experiments', id: 'unknown' } },
            },
          },
        })
        .expect(403, {
          errors: [
            {
              status: 'Forbidden',
              code: 'EXPERIMENT_NOT_FOUND',
              detail: 'Experiment "unknown" not found.',
            },
          ],
        })
        .expect('Content-Type', apiContentTypeRegExp);
    });

    it('refuses to create a run if a run with this name already exists for this experiment', async ({
      context: { api, dataStore, experimentId },
    }) => {
      await dataStore.withTransaction((tx) =>
        tx.addRun({ runName: 'test-run', experimentId }),
      );
      await api
        .post('/runs')
        .send({
          data: {
            type: 'runs',
            attributes: { status: 'idle', name: 'test-run' },
            relationships: {
              experiment: { data: { type: 'experiments', id: experimentId } },
            },
          },
        })
        .set('content-type', mediaType)
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
  'createLogServer: get /runs/:run ($sessionType / $storeType)',
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
        const { runId } = await dataStore.withTransaction((tx) =>
          tx.addRun({ runName: 'my-run-name', experimentId: experimentId }),
        );
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
        const { runId } = await dataStore.withTransaction((tx) =>
          tx.addRun({ runName: 'my-run-name', experimentId: experimentId }),
        );
        await api.get(`/runs/${runId}`).expect(200);
      });
    }

    it('returns a run if client has access to it', async ({
      context: { api, dataStore, sessionStore, experimentId },
      expect,
    }) => {
      const { runId } = await dataStore.withTransaction((tx) =>
        tx.addRun({ runName: 'run-name', runStatus: 'running', experimentId }),
      );
      const logs = await dataStore.withTransaction((tx) =>
        tx.addLogs(runId, [
          { type: 'log-type-1', number: 1, values: {} },
          { type: 'log-type-3', number: 2, values: { p3: 'v3' } },
          { type: 'log-type-2', number: 3, values: {} },
          { type: 'log-type-1', number: 4, values: { p1: 'v1' } },
          { type: 'log-type-2', number: 5, values: {} },
          { type: 'log-type-2', number: 6, values: {} },
          { type: 'log-type-2', number: 7, values: {} },
          { type: 'log-type-2', number: 8, values: { p2: 'v2' } },
          { type: 'log-type-2', number: 10, values: { p3: 'v3' } },
        ]),
      );
      await addRunToSession({ api, sessionStore, runId });
      const { body } = await api
        .get(`/runs/${runId}`)
        .expect(200)
        .expect('Content-Type', apiContentTypeRegExp);
      expect(body).toEqual({
        data: {
          id: runId,
          type: 'runs',
          attributes: {
            name: 'run-name',
            status: 'running',
            lastLogNumber: 8,
            firstMissingLogNumber: 9,
          },
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
      const { runId } = await dataStore.withTransaction((tx) =>
        tx.addRun({ experimentId, runStatus: 'running', runName: null }),
      );
      const logs = await dataStore.withTransaction((tx) =>
        tx.addLogs(runId, [
          { type: 'log-type', number: 1, values: {} },
          { type: 'log-type', number: 2, values: {} },
          { type: 'log-type', number: 4, values: {} },
          { type: 'log-type', number: 6, values: {} },
        ]),
      );
      await addRunToSession({ api, sessionStore, runId });
      const { body } = await api
        .get(`/runs/${runId}`)
        .expect(200)
        .expect('Content-Type', apiContentTypeRegExp);
      expect(body).toEqual({
        data: {
          id: runId,
          type: 'runs',
          attributes: {
            status: 'running',
            lastLogNumber: 2,
            name: null,
            firstMissingLogNumber: 3,
          },
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
  'createLogServer: patch /runs/:run ($sessionType / $storeType)',
  ({ test: it, sessionType }) => {
    it('returns a 404 error if the client tries to change the status of the run that does not exist', async ({
      context: { api },
    }) => {
      await api
        .patch('/runs/does-not-exist')
        .set('content-type', mediaType)
        .send({
          data: {
            id: 'does-not-exist',
            type: 'runs',
            attributes: { status: 'completed', name: null },
          },
        })
        .expect(404);
    });

    if (sessionType === 'host') {
      it('lets a host cancel a run another session created', async ({
        expect,
        context: { api, dataStore, experimentId },
      }) => {
        const { runId } = await dataStore.withTransaction((tx) =>
          tx.addRun({ experimentId, runName: 'orphan', runStatus: 'running' }),
        );
        await api
          .patch(`/runs/${runId}`)
          .set('content-type', mediaType)
          .send({
            data: {
              id: runId,
              type: 'runs',
              attributes: { status: 'canceled' },
            },
          })
          .expect(200);
        const [run] = await dataStore.getRuns({ runId });
        expect(run?.runStatus).toBe('canceled');
      });

      it('returns a 403 error if a host tries to change a run another session created', async ({
        expect,
        context: { api, dataStore, experimentId },
      }) => {
        const { runId } = await dataStore.withTransaction((tx) =>
          tx.addRun({ experimentId, runName: null, runStatus: 'running' }),
        );
        await api
          .patch(`/runs/${runId}`)
          .set('content-type', mediaType)
          .send({
            data: {
              id: runId,
              type: 'runs',
              attributes: { status: 'completed' },
            },
          })
          .expect(403, {
            errors: [
              {
                status: 'Forbidden',
                code: 'RUN_NOT_OWNED',
                detail: `Run "${runId}" belongs to another session. Only the session that created a run can write to it.`,
              },
            ],
          });
        const [run] = await dataStore.getRuns({ runId });
        expect(run?.runStatus).toBe('running');
      });
    }

    if (sessionType === 'participant') {
      it('returns a 404 error if a participant tries to change the status of the run but does not have access to that run', async ({
        context: { api, dataStore, experimentId, sessionStore },
      }) => {
        const { runId: otherRunId } = await dataStore.withTransaction((tx) =>
          tx.addRun({ experimentId, runName: null }),
        );
        await addRunToSession({ api, runId: otherRunId, sessionStore });
        const { runId } = await dataStore.withTransaction((tx) =>
          tx.addRun({ experimentId, runName: null }),
        );
        await api
          .patch(`/runs/${runId}`)
          .set('content-type', mediaType)
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
        const { runId: otherRunId } = await dataStore.withTransaction((tx) =>
          tx.addRun({ experimentId, runName: null }),
        );
        await addRunToSession({ api, runId: otherRunId, sessionStore });
        const { runId } = await dataStore.withTransaction((tx) =>
          tx.addRun({ experimentId, runName: null }),
        );
        await api
          .patch(`/runs/${runId}`)
          .set('content-type', mediaType)
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

    // The transition table is tested in run-lifecycle.test.ts.
    it('changes the status of a run', async ({
      expect,
      context: { api, dataStore, experimentId, sessionStore },
    }) => {
      const { runId } = await dataStore.withTransaction((tx) =>
        tx.addRun({ experimentId, runStatus: 'idle', runName: null }),
      );
      await addRunToSession({ api, runId, sessionStore });
      await api
        .patch(`/runs/${runId}`)
        .set('content-type', mediaType)
        .send({
          data: { id: runId, type: 'runs', attributes: { status: 'running' } },
        })
        .expect(200);
      const [runRecord] = await dataStore.getRuns({ runId });
      expect(runRecord!.runStatus).toBe('running');
    });

    it('refuses an illegal status transition', async ({
      expect,
      context: { api, dataStore, experimentId, sessionStore },
    }) => {
      const { runId } = await dataStore.withTransaction((tx) =>
        tx.addRun({ experimentId, runStatus: 'completed' }),
      );
      await addRunToSession({ api, runId, sessionStore });
      await api
        .patch(`/runs/${runId}`)
        .set('content-type', mediaType)
        .send({
          data: { id: runId, type: 'runs', attributes: { status: 'running' } },
        })
        .expect(403, {
          errors: [
            {
              status: 'Forbidden',
              code: 'INVALID_STATUS_TRANSITION',
              detail:
                'Cannot change run status from completed to running. Allowed transitions are: completed -> canceled.',
            },
          ],
        })
        .expect('Content-Type', apiContentTypeRegExp);
      const [runRecord] = await dataStore.getRuns({ runId });
      expect(runRecord!.runStatus).toBe('completed');
    });

    it('accepts but does nothing when nothing to change is requested', async ({
      expect,
      context: { api, dataStore, experimentId, sessionStore },
    }) => {
      const runRecord = await dataStore.withTransaction((tx) =>
        tx.addRun({ experimentId }),
      );
      await addRunToSession({ api, runId: runRecord.runId, sessionStore });
      await api
        .patch(`/runs/${runRecord.runId}`)
        .set('content-type', mediaType)
        .send({ data: { id: runRecord.runId, type: 'runs' } })
        .expect(200);
      const [r1] = await dataStore.getRuns({ runId: runRecord.runId });
      expect(r1).toEqual(runRecord);
      await api
        .patch(`/runs/${runRecord.runId}`)
        .set('content-type', mediaType)
        .send({ data: { id: runRecord.runId, type: 'runs', attributes: {} } })
        .expect(200);
      const [r2] = await dataStore.getRuns({ runId: runRecord.runId });
      expect(r2).toEqual(runRecord);
    });

    it('refuses to complete a run if there are missing logs', async ({
      expect,
      context: { api, dataStore, sessionStore, experimentId },
    }) => {
      const runRecord = await dataStore.withTransaction((tx) =>
        tx.addRun({ experimentId, runStatus: 'running' }),
      );
      await dataStore.withTransaction((tx) =>
        tx.addLogs(runRecord.runId, [
          { type: 'log-type', number: 1, values: {} },
          // Log with number 2 is missing, so there are missing logs.
          { type: 'log-type', number: 3, values: {} },
        ]),
      );
      await addRunToSession({ api, runId: runRecord.runId, sessionStore });
      let answer = await api
        .patch(`/runs/${runRecord.runId}`)
        .set('content-type', mediaType)
        .send({
          data: {
            id: runRecord.runId,
            type: 'runs',
            attributes: { status: 'completed' },
          },
        })
        .expect(403)
        .expect('Content-Type', apiContentTypeRegExp);
      expect(answer.body).toMatchSnapshot();
      const [r1] = await dataStore.getRuns({ runId: runRecord.runId });
      expect(r1).toEqual({
        ...runRecord,
        firstMissingLogNumber: 2,
        lastLogNumber: 1,
      });
    });

    it('refuses to complete a run after a far-ahead log number', async ({
      expect,
      context: { api, dataStore, sessionStore, experimentId },
    }) => {
      const { runId } = await dataStore.withTransaction((tx) =>
        tx.addRun({ experimentId, runStatus: 'running' }),
      );
      await dataStore.withTransaction((tx) =>
        tx.addLogs(runId, [
          { type: 'log-type', number: 1, values: {} },
          { type: 'log-type', number: 10 ** 12, values: {} },
        ]),
      );
      await addRunToSession({ api, runId, sessionStore });
      const { body } = await api.get(`/runs/${runId}`).expect(200);
      expect(body.data.attributes).toMatchObject({
        lastLogNumber: 1,
        firstMissingLogNumber: 2,
      });
      await api
        .patch(`/runs/${runId}`)
        .set('content-type', mediaType)
        .send({
          data: {
            id: runId,
            type: 'runs',
            attributes: { status: 'completed' },
          },
        })
        .expect(403, {
          errors: [
            {
              status: 'Forbidden',
              code: 'MISSING_LOGS',
              detail:
                'Cannot complete run: log number 2 is missing. Add all logs before completing the run.',
            },
          ],
        });
    });

    it('updates logs according to lastLogNumber when resuming', async ({
      expect,
      context: { api, experimentId, dataStore, sessionStore },
    }) => {
      const { runId } = await dataStore.withTransaction((tx) =>
        tx.addRun({ experimentId, runStatus: 'running' }),
      );
      await dataStore.withTransaction((tx) =>
        tx.addLogs(runId, [
          { type: 'log-type', number: 1, values: { v: 1 } },
          { type: 'log-type', number: 2, values: { v: 2 } },
          { type: 'log-type', number: 3, values: { v: 3 } },
          // Log with number 4 is missing, so there are missing logs.
          { type: 'log-type', number: 6, values: { v: 6 } },
          { type: 'log-type', number: 7, values: { v: 7 } },
        ]),
      );
      await addRunToSession({ api, runId: runId, sessionStore });
      await api
        .patch(`/runs/${runId}`)
        .set('content-type', mediaType)
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
        const { runId } = await dataStore.withTransaction((tx) =>
          tx.addRun({ experimentId, runStatus: 'running' }),
        );
        await dataStore.withTransaction((tx) =>
          tx.addLogs(runId, [
            { type: 'log-type', number: 1, values: { v: 'v1' } },
            { type: 'log-type', number: 2, values: { v: 'v2' } },
            { type: 'log-type', number: 3, values: { v: 'v3' } },
          ]),
        );
        await dataStore.withTransaction((tx) => tx.setRunStatus(runId, status));
        await addRunToSession({ api, runId, sessionStore });
        await api
          .patch(`/runs/${runId}`)
          .set('content-type', mediaType)
          .send({
            data: { id: runId, type: 'runs', attributes: { lastLogNumber: 1 } },
          })
          .expect(403, {
            errors: [
              {
                status: 'Forbidden',
                code: 'INVALID_LAST_LOG_NUMBER',
                detail:
                  'Updating last log number is only allowed when resuming a run.',
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
      const { runId } = await dataStore.withTransaction((tx) =>
        tx.addRun({ experimentId, runStatus: 'running' }),
      );
      await dataStore.withTransaction((tx) =>
        tx.addLogs(runId, [
          { type: 'log-type', number: 1, values: { v: 'v1' } },
          { type: 'log-type', number: 2, values: { v: 'v2' } },
          { type: 'log-type', number: 3, values: { v: 'v3' } },
        ]),
      );
      await dataStore.withTransaction((tx) =>
        tx.setRunStatus(runId, 'interrupted'),
      );
      await addRunToSession({ api, runId, sessionStore });
      await api
        .patch(`/runs/${runId}`)
        .set('content-type', mediaType)
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

    it('refuses a resume point above the last log number', async ({
      expect,
      context: { api, dataStore, experimentId, sessionStore },
    }) => {
      const { runId } = await dataStore.withTransaction((tx) =>
        tx.addRun({ experimentId, runStatus: 'running' }),
      );
      await dataStore.withTransaction((tx) =>
        tx.addLogs(runId, [
          { type: 'log-type', number: 1, values: {} },
          { type: 'log-type', number: 2, values: {} },
          { type: 'log-type', number: 3, values: {} },
        ]),
      );
      await addRunToSession({ api, runId, sessionStore });
      await api
        .patch(`/runs/${runId}`)
        .set('content-type', mediaType)
        .send({
          data: { id: runId, type: 'runs', attributes: { lastLogNumber: 10 } },
        })
        .expect(403, {
          errors: [
            {
              status: 'Forbidden',
              code: 'INVALID_LAST_LOG_NUMBER',
              detail:
                'Cannot set last log number to 10, run has only 3 logs. Ensure the last log number is less than or equal to the last log number of the run.',
            },
          ],
        })
        .expect('Content-Type', apiContentTypeRegExp);
      await expect(dataStore.getRuns({ runId })).resolves.toMatchObject([
        { runStatus: 'running', lastLogNumber: 3 },
      ]);
    });

    // A resume leaves the run running, so it cannot also end it. Completing
    // with the run's own last log number used to resume the run instead.
    it.for([
      { from: 'running', status: 'completed', lastLogNumber: 1 },
      { from: 'running', status: 'completed', lastLogNumber: 2 },
      { from: 'completed', status: 'canceled', lastLogNumber: 2 },
    ] as const)(
      'refuses the last log number $lastLogNumber with the status $status instead of resuming',
      async (
        { from, status, lastLogNumber },
        { expect, context: { api, dataStore, experimentId, sessionStore } },
      ) => {
        const { runId } = await dataStore.withTransaction((tx) =>
          tx.addRun({ experimentId, runStatus: 'running' }),
        );
        await dataStore.withTransaction((tx) =>
          tx.addLogs(runId, [
            { type: 'log-type', number: 1, values: {} },
            { type: 'log-type', number: 2, values: {} },
          ]),
        );
        await dataStore.withTransaction((tx) => tx.setRunStatus(runId, from));
        await addRunToSession({ api, runId, sessionStore });
        await api
          .patch(`/runs/${runId}`)
          .set('content-type', mediaType)
          .send({
            data: {
              id: runId,
              type: 'runs',
              attributes: { status, lastLogNumber },
            },
          })
          .expect(400, {
            errors: [
              {
                status: 'Bad Request',
                code: 'INVALID_REQUEST_BODY',
                detail:
                  "lastLogNumber resumes the run, so it requires the status 'running'.",
                source: { pointer: '/data/attributes/lastLogNumber' },
              },
            ],
          })
          .expect('Content-Type', apiContentTypeRegExp);
        await expect(dataStore.getRuns({ runId })).resolves.toMatchObject([
          { runStatus: from, lastLogNumber: 2 },
        ]);
      },
    );

    it('accepts completing a completed run that has a missing log number', async ({
      context: { api, dataStore, experimentId, sessionStore },
    }) => {
      const { runId } = await dataStore.withTransaction((tx) =>
        tx.addRun({ experimentId, runStatus: 'running' }),
      );
      await dataStore.withTransaction(async (tx) => {
        await tx.addLogs(runId, [
          { type: 'log-type', number: 1, values: {} },
          { type: 'log-type', number: 3, values: {} },
        ]);
        await tx.setRunStatus(runId, 'completed');
      });
      await addRunToSession({ api, runId, sessionStore });
      await api
        .patch(`/runs/${runId}`)
        .set('content-type', mediaType)
        .send({
          data: {
            id: runId,
            type: 'runs',
            attributes: { status: 'completed' },
          },
        })
        .expect(200);
    });

    describe('name and experiment', () => {
      const patch = (
        api: request.Agent,
        runId: string,
        data: Record<string, unknown>,
      ) =>
        api
          .patch(`/runs/${runId}`)
          .set('content-type', mediaType)
          .send({ data: { id: runId, type: 'runs', ...data } });

      it('refuses to change the id', async ({
        context: { api, dataStore, experimentId, sessionStore },
      }) => {
        const { runId } = await dataStore.withTransaction((tx) =>
          tx.addRun({ experimentId, runName: 'name' }),
        );
        await addRunToSession({ api, runId, sessionStore });
        await patch(api, runId, { id: 'other-id' })
          .expect(403, {
            errors: [
              {
                status: 'Forbidden',
                code: 'INVALID_RUN_ID',
                detail: `A run's id cannot be changed. Remove the 'id' attribute from the request body.`,
              },
            ],
          })
          .expect('Content-Type', apiContentTypeRegExp);
      });

      it.for([{ name: 'other-name' }, { name: null }])(
        'refuses to change the name to $name',
        async (
          attributes,
          { expect, context: { api, dataStore, experimentId, sessionStore } },
        ) => {
          const { runId } = await dataStore.withTransaction((tx) =>
            tx.addRun({ experimentId, runName: 'name' }),
          );
          await addRunToSession({ api, runId, sessionStore });
          await patch(api, runId, { attributes })
            .expect(403, {
              errors: [
                {
                  status: 'Forbidden',
                  code: 'IMMUTABLE_RUN_ATTRIBUTE',
                  detail: `A run's name cannot be changed. Remove the 'name' attribute from the request body.`,
                  source: { pointer: '/data/attributes/name' },
                },
              ],
            })
            .expect('Content-Type', apiContentTypeRegExp);
          await expect(dataStore.getRuns({ runId })).resolves.toMatchObject([
            { runName: 'name' },
          ]);
        },
      );

      it('refuses to change the experiment', async ({
        expect,
        context: { api, dataStore, experimentId, sessionStore },
      }) => {
        const { experimentId: otherExperimentId } =
          await dataStore.withTransaction((tx) =>
            tx.addExperiment({ experimentName: 'other-experiment' }),
          );
        const { runId } = await dataStore.withTransaction((tx) =>
          tx.addRun({ experimentId }),
        );
        await addRunToSession({ api, runId, sessionStore });
        await patch(api, runId, {
          relationships: {
            experiment: {
              data: { type: 'experiments', id: otherExperimentId },
            },
          },
        })
          .expect(403, {
            errors: [
              {
                status: 'Forbidden',
                code: 'IMMUTABLE_RUN_ATTRIBUTE',
                detail: `A run's experiment cannot be changed. Remove the 'experiment' relationship from the request body.`,
                source: { pointer: '/data/relationships/experiment' },
              },
            ],
          })
          .expect('Content-Type', apiContentTypeRegExp);
        await expect(dataStore.getRuns({ runId })).resolves.toMatchObject([
          { experimentId },
        ]);
      });

      it('ignores the name and experiment when they do not change', async ({
        context: { api, dataStore, experimentId, sessionStore },
      }) => {
        const { runId } = await dataStore.withTransaction((tx) =>
          tx.addRun({ experimentId, runName: 'name' }),
        );
        await addRunToSession({ api, runId, sessionStore });
        await patch(api, runId, {
          attributes: { name: 'name', status: 'running' },
          relationships: {
            experiment: { data: { type: 'experiments', id: experimentId } },
          },
        }).expect(200);
      });
    });

    it('rolls back the cancellation of logs when setting the status fails', async ({
      expect,
      context: { api, dataStore, experimentId, sessionStore },
    }) => {
      const { runId } = await dataStore.withTransaction((tx) =>
        tx.addRun({ experimentId, runStatus: 'running' }),
      );
      await dataStore.withTransaction((tx) =>
        tx.addLogs(runId, [
          { type: 'log-type', number: 1, values: {} },
          { type: 'log-type', number: 2, values: {} },
          { type: 'log-type', number: 3, values: {} },
        ]),
      );
      await dataStore.withTransaction((tx) =>
        tx.setRunStatus(runId, 'interrupted'),
      );
      await addRunToSession({ api, runId, sessionStore });
      dataStore.tx.setRunStatus.mockRejectedValueOnce(new Error('disk full'));
      await api
        .patch(`/runs/${runId}`)
        .set('content-type', mediaType)
        .send({
          data: {
            id: runId,
            type: 'runs',
            attributes: { status: 'running', lastLogNumber: 1 },
          },
        })
        .expect(500);
      await expect(dataStore.getRuns({ runId })).resolves.toMatchObject([
        { runStatus: 'interrupted', lastLogNumber: 3 },
      ]);
      await expect(
        fromAsync(dataStore.getLogs({ runId })),
      ).resolves.toHaveLength(3);
    });

    it('updates a run even if another run of the session is ongoing', async ({
      expect,
      context: { api, dataStore, experimentId, sessionStore },
    }) => {
      const [ongoing, idle] = await dataStore.withTransaction(async (tx) => [
        await tx.addRun({ experimentId, runStatus: 'running' }),
        await tx.addRun({ experimentId, runStatus: 'idle' }),
      ]);
      await addRunToSession({ api, runId: ongoing.runId, sessionStore });
      await addRunToSession({ api, runId: idle.runId, sessionStore });
      await api
        .patch(`/runs/${idle.runId}`)
        .set('content-type', mediaType)
        .send({
          data: {
            id: idle.runId,
            type: 'runs',
            attributes: { status: 'running' },
          },
        })
        .expect(200);
      await expect(
        dataStore.getRuns({ runId: idle.runId }),
      ).resolves.toMatchObject([{ runStatus: 'running' }]);
    });

    it('accepts a request that changes nothing while another run is ongoing', async ({
      expect,
      context: { api, dataStore, experimentId, sessionStore },
    }) => {
      const [ongoing, other] = await dataStore.withTransaction(async (tx) => [
        await tx.addRun({ experimentId, runStatus: 'running' }),
        await tx.addRun({ experimentId, runStatus: 'running' }),
      ]);
      await addRunToSession({ api, runId: ongoing.runId, sessionStore });
      await addRunToSession({ api, runId: other.runId, sessionStore });
      await api
        .patch(`/runs/${other.runId}`)
        .set('content-type', mediaType)
        .send({
          data: {
            id: other.runId,
            type: 'runs',
            attributes: { status: 'running' },
          },
        })
        .expect(200);
      await expect(
        dataStore.getRuns({ runId: other.runId }),
      ).resolves.toMatchObject([{ runStatus: 'running' }]);
    });

    it('lets only one of two concurrent conflicting updates through', async ({
      expect,
      context: { api, dataStore, experimentId, sessionStore },
    }) => {
      const { runId } = await dataStore.withTransaction((tx) =>
        tx.addRun({ experimentId, runStatus: 'running' }),
      );
      await addRunToSession({ api, runId, sessionStore });
      const update = (status: RunStatus) =>
        api
          .patch(`/runs/${runId}`)
          .set('content-type', mediaType)
          .send({ data: { id: runId, type: 'runs', attributes: { status } } });
      // Neither of completed and interrupted can follow the other.
      const [completed, interrupted] = await Promise.all([
        update('completed'),
        update('interrupted'),
      ]);
      expect([completed.status, interrupted.status].sort()).toEqual([200, 403]);
      const winner = completed.status === 200 ? 'completed' : 'interrupted';
      await expect(dataStore.getRuns({ runId })).resolves.toMatchObject([
        { runStatus: winner },
      ]);
    });
  },
);

describeForAll(
  'createLogServer: get /runs ($sessionType / $storeType)',
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
        const { runId: r1 } = await dataStore.withTransaction((tx) =>
          tx.addRun({ ...baseRunOptions, runName: 'run-1' }),
        );
        await dataStore.withTransaction((tx) =>
          tx.addLogs(r1, [
            { type: 'log-type', number: 1, values: { v: 'r1l1' } },
            { type: 'log-type', number: 2, values: { v: 'r1l2' } },
            { type: 'log-type', number: 4, values: { v: 'r1l4' } },
          ]),
        );
        const { runId: r2 } = await dataStore.withTransaction((tx) =>
          tx.addRun({ ...baseRunOptions, runName: 'run-2' }),
        );
        await dataStore.withTransaction((tx) =>
          tx.addLogs(r2, [
            { type: 'log-type', number: 1, values: { v: 'r2l1' } },
          ]),
        );
        await addRunToSession({ api, sessionStore, runId: r1 });
        const response = await api
          .get('/runs')
          .expect(200)
          .expect('Content-Type', apiContentTypeRegExp);
        expect(response.body).toMatchSnapshot();
      },
    );

    async function setup3runsIn2experiments(dataStore: DataStore) {
      const { experimentId: e1 } = await dataStore.withTransaction((tx) =>
        tx.addExperiment({ experimentName: 'experiment-1' }),
      );
      const { runId: r1 } = await dataStore.withTransaction((tx) =>
        tx.addRun({ experimentId: e1, runStatus: 'running', runName: 'run-1' }),
      );
      await dataStore.withTransaction((tx) =>
        tx.addLogs(r1, [
          { type: 'log-type', number: 1, values: { v: 'r1l1' } },
          { type: 'log-type', number: 2, values: { v: 'r1l2' } },
          { type: 'log-type', number: 4, values: { v: 'r1l4' } },
        ]),
      );
      const { runId: r2 } = await dataStore.withTransaction((tx) =>
        tx.addRun({
          experimentId: e1,
          runStatus: 'completed',
          runName: 'run-2',
        }),
      );
      const { experimentId: e2 } = await dataStore.withTransaction((tx) =>
        tx.addExperiment({ experimentName: 'experiment-2' }),
      );
      const { runId: r3 } = await dataStore.withTransaction((tx) =>
        tx.addRun({ experimentId: e2, runStatus: 'running' }),
      );
      await dataStore.withTransaction((tx) =>
        tx.addLogs(r3, [
          { type: 'log-type', number: 1, values: { v: 'r3l1' } },
        ]),
      );
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
        ? 'returns a 200 with all runs with requested related lastLogs and experiment'
        : 'returns a 200 with participant-owned runs with requested related lastLogs and experiment',
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
