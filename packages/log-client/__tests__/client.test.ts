import { describe, expect, vi } from 'vitest';
import { serverTest } from '../__mocks__/mock-server.js';
import { paths } from '../generated/api.js';
import { LightmillClient } from '../src/client.js';
import { LightmillLogger } from '../src/logger.js';

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
        logs: [
          { type: 'test-type', count: 4, lastNumber: 5, pending: 1 },
          { type: 'other-type', count: 3, lastNumber: 8, pending: 4 },
        ],
      },
      {
        runId: 'test-run2',
        experimentId: 'test-experiment',
        runStatus: 'interrupted',
        logs: [
          { type: 'test-type', count: 6, lastNumber: 7, pending: 0 },
          { type: 'other-type', count: 3, lastNumber: 2, pending: 1 },
        ],
      },
    ]);
    await expect(
      client.getResumableRuns({ resumableLogTypes: ['test-type'] }),
    ).resolves.toEqual([
      {
        runId: 'test-run1',
        runName: 'test-run1-name',
        experimentId: 'test-experiment',
        experimentName: 'test-experiment-name',
        runStatus: 'running',
        from: { logType: 'test-type', logNumber: 5 },
      },
      {
        runId: 'test-run2',
        runName: 'test-run2-name',
        experimentId: 'test-experiment',
        experimentName: 'test-experiment-name',
        runStatus: 'interrupted',
        from: { logType: 'test-type', logNumber: 7 },
      },
    ]);
  });

  it('should ignore ended runs', async ({ expect, server, client }) => {
    server.set([
      {
        runId: 'test-run1',
        experimentId: 'test-experiment',
        runStatus: 'canceled',
        logs: [{ type: 'test-type', count: 5, lastNumber: 5, pending: 1 }],
      },
      {
        runId: 'test-run2',
        experimentId: 'test-experiment',
        runStatus: 'interrupted',
        logs: [{ type: 'test-type', count: 2, lastNumber: 2, pending: 0 }],
      },
      {
        runId: 'test-run3',
        experimentId: 'test-experiment',
        runStatus: 'completed',
        logs: [{ type: 'test-type', count: 5, lastNumber: 5, pending: 1 }],
      },
    ]);
    await expect(
      client.getResumableRuns({ resumableLogTypes: ['test-type'] }),
    ).resolves.toEqual([
      {
        runName: 'test-run2-name',
        runId: 'test-run2',
        experimentName: 'test-experiment-name',
        experimentId: 'test-experiment',
        runStatus: 'interrupted',
        from: { logType: 'test-type', logNumber: 2 },
      },
    ]);
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
        logs: [
          { type: 'test-type-1', count: 5, lastNumber: 10, pending: 0 },
          { type: 'test-type-2', count: 5, lastNumber: 5, pending: 0 },
          { type: 'other-type', count: 5, lastNumber: 15, pending: 1 },
        ],
      },
    ]);
    await expect(
      client.getResumableRuns({
        resumableLogTypes: ['test-type-1', 'test-type-2'],
      }),
    ).resolves.toEqual([
      { ...run, from: { logType: 'test-type-1', logNumber: 10 } },
    ]);
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
        logs: [{ type: 'test-type', count: 5, lastNumber: 5, pending: 0 }],
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
        logs: [{ type: 'other-type', count: 5, lastNumber: 5, pending: 0 }],
      },
    ]);
    await expect(
      client.getResumableRuns({ resumableLogTypes: ['test-type'] }),
    ).resolves.toEqual([
      {
        runId: 'test-run',
        runName: 'test-run-name',
        experimentId: 'test-experiment',
        experimentName: 'test-experiment-name',
        runStatus: 'running',
        from: { logType: null, logNumber: 0 },
      },
    ]);
  });
});

describe('LogClient#startRun', () => {
  it('should send a start request', async ({ expect, server, client }) => {
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
            attributes: { status: 'running' },
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

  it('should send a start request with parameters', async ({
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
      from: { logNumber: 4 },
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
      from: { logNumber: 0 },
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
  [K in M]: { requestBody: { content: { 'application/json': infer B } } };
}
  ? B
  : paths[P] extends {
        [K in M]: {
          requestBody?: { content: { 'application/json': infer B } };
        };
      }
    ? B | undefined
    : never;
