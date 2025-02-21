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
    server.setRuns([
      {
        runName: 'test-run1',
        experimentName: 'test-experiment',
        runStatus: 'running',
        logs: [
          { type: 'test-type', count: 4, lastNumber: 5, pending: 1 },
          { type: 'other-type', count: 3, lastNumber: 7, pending: 4 },
        ],
      },
      {
        runName: 'test-run2',
        experimentName: 'test-experiment',
        runStatus: 'interrupted',
        logs: [
          { type: 'test-type', count: 6, lastNumber: 7, pending: 0 },
          { type: 'other-type', count: 3, lastNumber: 9, pending: 1 },
        ],
      },
    ]);
    await expect(
      client.getResumableRuns({ resumableLogTypes: ['test-type'] }),
    ).resolves.toEqual([
      {
        runName: 'test-run1',
        experimentName: 'test-experiment',
        runStatus: 'running',
        resumesAfter: { logType: 'test-type', logNumber: 5 },
      },
      {
        runName: 'test-run2',
        experimentName: 'test-experiment',
        runStatus: 'interrupted',
        resumesAfter: { logType: 'test-type', logNumber: 7 },
      },
    ]);
  });

  it('should ignore ended runs', async ({ expect, server, client }) => {
    server.setRuns([
      {
        runName: 'test-run1',
        experimentName: 'test-experiment',
        runStatus: 'canceled',
        logs: [{ type: 'test-type', count: 5, lastNumber: 5, pending: 1 }],
      },
      {
        runName: 'test-run2',
        experimentName: 'test-experiment',
        runStatus: 'interrupted',
        logs: [{ type: 'test-type', count: 2, lastNumber: 2, pending: 0 }],
      },
      {
        runName: 'test-run3',
        experimentName: 'test-experiment',
        runStatus: 'completed',
        logs: [{ type: 'test-type', count: 5, lastNumber: 5, pending: 1 }],
      },
    ]);
    await expect(
      client.getResumableRuns({ resumableLogTypes: ['test-type'] }),
    ).resolves.toEqual([
      {
        runName: 'test-run2',
        experimentName: 'test-experiment',
        runStatus: 'interrupted',
        resumesAfter: { logType: 'test-type', logNumber: 2 },
      },
    ]);
  });

  it('should find the latest log type', async ({ expect, server, client }) => {
    const run = {
      runName: 'test-run',
      experimentName: 'test-experiment',
      runStatus: 'running',
    } as const;
    server.setRuns([
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
      { ...run, resumesAfter: { logType: 'test-type-1', logNumber: 10 } },
    ]);
  });

  it('should return an empty array if no resumable runs are found', async ({
    expect,
    server,
    client,
  }) => {
    server.setRuns([
      {
        runName: 'test-run',
        experimentName: 'test-experiment',
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
    server.setRuns([
      {
        runName: 'test-run',
        experimentName: 'test-experiment',
        runStatus: 'running',
        logs: [{ type: 'other-type', count: 5, lastNumber: 5, pending: 0 }],
      },
    ]);
    await expect(
      client.getResumableRuns({ resumableLogTypes: ['test-type'] }),
    ).resolves.toEqual([
      {
        runName: 'test-run',
        experimentName: 'test-experiment',
        runStatus: 'running',
        resumesAfter: { logType: null, logNumber: 0 },
      },
    ]);
  });
});

describe('LogClient#startRun', () => {
  it('should send a start request', async ({ expect, server, client }) => {
    let logger = await client.startRun();
    expect(logger).toBeInstanceOf(LightmillLogger);
    await expect(server.waitForChangeRequests()).resolves.toEqual([
      {
        url: 'https://server.test/api/runs',
        method: 'POST',
        body: {} satisfies ApiBody<'post', '/runs'>,
      },
    ]);
  });

  it('should send a start request with parameters', async ({
    expect,
    server,
    client,
  }) => {
    let logger = await client.startRun({
      runName: 'test-run',
      experimentName: 'test-experiment',
    });
    expect(logger).toBeInstanceOf(LightmillLogger);
    await expect(server.waitForChangeRequests()).resolves.toEqual([
      {
        url: 'https://server.test/api/runs',
        method: 'POST',
        body: {
          runName: 'test-run',
          experimentName: 'test-experiment',
        } satisfies ApiBody<'post', '/runs'>,
      },
    ]);
  });

  it('should resume an existing run if resumesAfter is provided', async ({
    server,
    client,
  }) => {
    server.setRuns([
      {
        experimentName: 'test-experiment',
        runName: 'test-run',
        runStatus: 'interrupted',
      },
    ]);
    let logger = await client.startRun({
      runName: 'test-run',
      experimentName: 'test-experiment',
      resumesAfter: { logNumber: 4 },
    });
    expect(logger).toBeInstanceOf(LightmillLogger);
    await expect(server.waitForChangeRequests()).resolves.toEqual([
      {
        url: 'https://server.test/api/experiments/test-experiment/runs/test-run',
        method: 'PATCH',
        body: { resumeFrom: 5, runStatus: 'running' } satisfies ApiBody<
          'patch',
          '/experiments/{experimentName}/runs/{runName}'
        >,
      },
    ]);
  });

  it('should be able to resume an existing run from the start', async ({
    server,
    client,
  }) => {
    server.setRuns([
      {
        experimentName: 'test-experiment',
        runName: 'test-run',
        runStatus: 'interrupted',
      },
    ]);
    let logger = await client.startRun({
      runName: 'test-run',
      experimentName: 'test-experiment',
      resumesAfter: { logNumber: 0 },
    });
    expect(logger).toBeInstanceOf(LightmillLogger);
    await expect(server.waitForChangeRequests()).resolves.toEqual([
      {
        url: 'https://server.test/api/experiments/test-experiment/runs/test-run',
        method: 'PATCH',
        body: { resumeFrom: 1, runStatus: 'running' } satisfies ApiBody<
          'patch',
          '/experiments/{experimentName}/runs/{runName}'
        >,
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
