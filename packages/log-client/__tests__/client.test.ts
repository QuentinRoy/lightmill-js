import type { mediaType } from '@lightmill/log-api/vocabulary';
import { describe, expect, vi } from 'vitest';
import { serverTest } from '../__mocks__/mock-server.js';
import { LightmillClient } from '../src/client.js';
import type { paths } from '../src/generated/openapi.js';
import { LightmillLogger } from '../src/logger.js';
import { RequestError } from '../src/utils.js';

const it = serverTest.extend<{ client: LightmillClient; timer: void }>({
  timer: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      vi.useFakeTimers({
        toFake: [
          'Date',
          'setTimeout',
          'clearTimeout',
          'setInterval',
          'clearInterval',
        ],
      });
      vi.setSystemTime(new Date('2022-12-31T23:00:00.000Z'));
      await use();
      vi.useRealTimers();
    },
    { auto: true },
  ],
  client: async ({ server }, use) => {
    const client = new LightmillClient({ apiRoot: server.getBaseUrl() });
    await use(client);
  },
});

describe('LogClient#getResumableRuns', () => {
  it('should fetch resumable runs', async ({ expect, server, client }) => {
    server.set([
      {
        runId: 'test-run1',
        experimentId: 'test-experiment',
        runStatus: 'running',
        lastLogs: [
          { type: 'test-type', number: 5, values: { prop: 'value-1' } },
          { type: 'other-type', number: 8, values: { prop: 'value-2' } },
        ],
      },
      {
        runId: 'test-run2',
        experimentId: 'test-experiment',
        runStatus: 'interrupted',
        lastLogs: [
          { type: 'test-type', number: 7, values: { prop: 'value-3' } },
          { type: 'other-type', number: 2, values: { prop: 'value-4' } },
        ],
      },
    ]);
    await expect(client.getResumableRuns({ resumableLogTypes: ['test-type'] }))
      .resolves.toMatchInlineSnapshot(`
      [
        {
          "experiment": {
            "id": "test-experiment",
            "name": "test-experiment-name",
          },
          "run": {
            "id": "test-run1",
            "name": "test-run1-name",
            "status": "running",
          },
          "toResumeAfter": {
            "log": {
              "date": "2022-12-31T23:00:00.000Z",
              "prop": "value-1",
              "type": "test-type",
            },
            "number": 5,
          },
        },
        {
          "experiment": {
            "id": "test-experiment",
            "name": "test-experiment-name",
          },
          "run": {
            "id": "test-run2",
            "name": "test-run2-name",
            "status": "interrupted",
          },
          "toResumeAfter": {
            "log": {
              "date": "2022-12-31T23:00:00.000Z",
              "prop": "value-3",
              "type": "test-type",
            },
            "number": 7,
          },
        },
      ]
    `);
  });

  it('should ignore ended runs', async ({ expect, server, client }) => {
    server.set([
      {
        runId: 'test-run1',
        experimentId: 'test-experiment',
        runStatus: 'canceled',
        lastLogs: [{ type: 'test-type', number: 5 }],
      },
      {
        runId: 'test-run2',
        experimentId: 'test-experiment',
        runStatus: 'interrupted',
        lastLogs: [
          {
            type: 'test-type',
            number: 2,
            values: {
              prop: 'value',
              date: new Date('2022-12-31T23:00:00.000Z'),
            },
          },
        ],
      },
      {
        runId: 'test-run3',
        experimentId: 'test-experiment',
        runStatus: 'completed',
        lastLogs: [{ type: 'test-type', number: 5 }],
      },
    ]);
    await expect(client.getResumableRuns({ resumableLogTypes: ['test-type'] }))
      .resolves.toMatchInlineSnapshot(`
      [
        {
          "experiment": {
            "id": "test-experiment",
            "name": "test-experiment-name",
          },
          "run": {
            "id": "test-run2",
            "name": "test-run2-name",
            "status": "interrupted",
          },
          "toResumeAfter": {
            "log": {
              "date": "2022-12-31T23:00:00.000Z",
              "prop": "value",
              "type": "test-type",
            },
            "number": 2,
          },
        },
      ]
    `);
  });

  it('should find the latest log type', async ({ expect, server, client }) => {
    const run = {
      runId: 'run-id',
      runName: 'run-name',
      experimentId: 'exp-id',
      experimentName: 'exp-name',
      runStatus: 'running',
    } as const;
    server.set([
      {
        ...run,
        lastLogs: [
          { type: 'test-type-1', number: 10 },
          { type: 'test-type-2', number: 5 },
          { type: 'other-type', number: 15 },
        ],
      },
    ]);
    await expect(
      client.getResumableRuns({
        resumableLogTypes: ['test-type-1', 'test-type-2'],
      }),
    ).resolves.toMatchInlineSnapshot(`
      [
        {
          "experiment": {
            "id": "exp-id",
            "name": "exp-name",
          },
          "run": {
            "id": "run-id",
            "name": "run-name",
            "status": "running",
          },
          "toResumeAfter": {
            "log": {
              "date": "2022-12-31T23:00:00.000Z",
              "type": "test-type-1",
            },
            "number": 10,
          },
        },
      ]
    `);
  });

  it('should return an empty array if no resumable runs are found', async ({
    expect,
    server,
    client,
  }) => {
    server.set([
      {
        runId: 'test-run',
        experimentId: 'test-experiment',
        runStatus: 'completed',
        lastLogs: [{ type: 'test-type', number: 5 }],
      },
    ]);
    await expect(
      client.getResumableRuns({ resumableLogTypes: ['test-type'] }),
    ).resolves.toEqual([]);
  });

  it('should suggest to resume from the start if no resumable logs are found', async ({
    expect,
    server,
    client,
  }) => {
    server.set([
      {
        runId: 'test-run',
        experimentId: 'test-experiment',
        runStatus: 'running',
        lastLogs: [{ type: 'other-type', number: 5 }],
      },
    ]);
    await expect(client.getResumableRuns({ resumableLogTypes: ['test-type'] }))
      .resolves.toMatchInlineSnapshot(`
      [
        {
          "experiment": {
            "id": "test-experiment",
            "name": "test-experiment-name",
          },
          "run": {
            "id": "test-run",
            "name": "test-run-name",
            "status": "running",
          },
          "toResumeAfter": {
            "log": null,
            "number": 0,
          },
        },
      ]
    `);
  });
});

describe('LogClient#startRun', () => {
  it('should post to /runs without a run name', async ({
    expect,
    server,
    client,
  }) => {
    server.set([{ experimentId: 'test-experiment' }]);
    let logger = await client.startRun({
      experimentName: 'test-experiment-name',
    });
    expect(logger).toBeInstanceOf(LightmillLogger);
    await expect(server.waitForChangeRequests()).resolves.toEqual([
      {
        url: 'https://server.test/api/runs',
        method: 'POST',
        body: {
          data: {
            type: 'runs',
            attributes: { status: 'running', name: null },
            relationships: {
              experiment: {
                data: { type: 'experiments', id: 'test-experiment' },
              },
            },
          },
        } satisfies ApiBody<'post', '/runs'>,
      },
    ]);
  });

  it('should post to /runs with a run name', async ({
    expect,
    server,
    client,
  }) => {
    server.set([{ experimentId: 'test-experiment' }]);
    let logger = await client.startRun({
      runName: 'test-run',
      experimentName: 'test-experiment-name',
    });
    expect(logger).toBeInstanceOf(LightmillLogger);
    await expect(server.waitForChangeRequests()).resolves.toEqual([
      {
        url: 'https://server.test/api/runs',
        method: 'POST',
        body: {
          data: {
            type: 'runs',
            attributes: { name: 'test-run', status: 'running' },
            relationships: {
              experiment: {
                data: { id: 'test-experiment', type: 'experiments' },
              },
            },
          },
        } satisfies ApiBody<'post', '/runs'>,
      },
    ]);
  });

  describe('without a session', () => {
    it.beforeEach(({ server }) => {
      server.set([{ experimentId: 'test-experiment' }]);
      server.handlers['/sessions/{id}'].get.mockResolvedValueOnce({
        status: 404,
        body: {
          errors: [{ status: 'Not Found', code: 'SESSION_NOT_FOUND' }],
        },
      });
    });

    it('should send credentials with every request', async ({
      expect,
      server,
    }) => {
      server.handlers['/sessions'].post.mockResolvedValueOnce({
        status: 201,
        body: {
          data: {
            type: 'sessions',
            id: 'test-session',
            attributes: { role: 'participant' },
            relationships: { runs: { data: [] } },
          },
        },
      });
      // Spying must happen before the client captures the global fetch.
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      const client = new LightmillClient({ apiRoot: server.getBaseUrl() });
      await client.startRun({ experimentName: 'test-experiment-name' });
      const requests = fetchSpy.mock.calls.map(([r]) => r as Request);
      expect(requests.map((r) => `${r.method} ${new URL(r.url).pathname}`))
        .toMatchInlineSnapshot(`
        [
          "GET /api/sessions/current",
          "POST /api/sessions",
          "GET /api/experiments",
          "POST /api/runs",
        ]
      `);
      expect(requests.map((r) => r.credentials)).toEqual(
        requests.map(() => 'include'),
      );
    });

    it('should fail if the session cannot be created', async ({
      expect,
      server,
      client,
    }) => {
      server.handlers['/sessions'].post.mockResolvedValueOnce({
        status: 403,
        body: {
          errors: [{ status: 'Forbidden', code: 'INVALID_CREDENTIALS' }],
        },
      });
      await expect(
        client.startRun({ experimentName: 'test-experiment-name' }),
      ).rejects.toThrow(RequestError);
      await expect(server.waitForChangeRequests()).resolves.toHaveLength(1);
    });
  });

  it('should resume an existing run if from is provided', async ({
    server,
    client,
  }) => {
    server.set([
      {
        experimentId: 'test-experiment',
        runId: 'test-run',
        runStatus: 'interrupted',
      },
    ]);
    let logger = await client.startRun({
      runName: 'test-run',
      experimentName: 'test-experiment',
      after: { number: 4 },
    });
    expect(logger).toBeInstanceOf(LightmillLogger);
    await expect(server.waitForChangeRequests()).resolves.toEqual([
      {
        url: 'https://server.test/api/runs/test-run',
        method: 'PATCH',
        body: {
          data: {
            type: 'runs',
            id: 'test-run',
            attributes: { status: 'running', lastLogNumber: 4 },
          },
        } satisfies ApiBody<'patch', '/runs/{id}'>,
      },
    ]);
  });

  it('should be able to resume an existing run from the start', async ({
    server,
    client,
  }) => {
    server.set([
      {
        experimentId: 'test-experiment',
        runId: 'test-run',
        runStatus: 'interrupted',
      },
    ]);
    let logger = await client.startRun({
      runName: 'test-run',
      experimentName: 'test-experiment',
      after: { number: 0 },
    });
    expect(logger).toBeInstanceOf(LightmillLogger);
    await expect(server.waitForChangeRequests()).resolves.toEqual([
      {
        url: 'https://server.test/api/runs/test-run',
        method: 'PATCH',
        body: {
          data: {
            type: 'runs',
            id: 'test-run',
            attributes: { status: 'running', lastLogNumber: 0 },
          },
        } satisfies ApiBody<'patch', '/runs/{id}'>,
      },
    ]);
  });
});

type Method = 'get' | 'post' | 'delete' | 'patch';

type ApiBody<M extends Method, P extends keyof paths> = paths[P] extends {
  [K in M]: { requestBody: { content: { [K in typeof mediaType]: infer B } } };
}
  ? B
  : paths[P] extends {
        [K in M]: {
          requestBody?: { content: { [K in typeof mediaType]: infer B } };
        };
      }
    ? B | undefined
    : never;
