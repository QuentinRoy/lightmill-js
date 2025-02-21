import { describe, expect, vi } from 'vitest';
import { serverTest } from '../__mocks__/mock-server.js';
import { LightmillLogger } from '../src/logger.js';
import { paths } from '../generated/api.js';
import createClient from 'openapi-fetch';

const it = serverTest.extend<{
  timer: void;
  logger: LightmillLogger;
  run: { experimentName: string; runName: string };
  resumedLogger: LightmillLogger;
  resumedLogCount: number;
}>({
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
  run: Object.freeze({ experimentName: 'exp-name', runName: 'run-name' }),
  logger: async ({ server, run }, use) => {
    const fetchClient = createClient<paths>({ baseUrl: server.getBaseUrl() });
    const logger = new LightmillLogger({
      fetchClient,
      ...run,
      logCount: 0,
      serializeLog: (x) => JSON.parse(JSON.stringify(x)),
    });
    server.reset();
    server.setRuns([run]);
    await use(logger);
  },
  resumedLogCount: 100,
  resumedLogger: async ({ server, resumedLogCount, run }, use) => {
    const fetchClient = createClient<paths>({ baseUrl: server.getBaseUrl() });
    const logger = new LightmillLogger({
      fetchClient,
      ...run,
      logCount: resumedLogCount,
      serializeLog: (x) => JSON.parse(JSON.stringify(x)),
    });
    server.reset();
    server.setRuns([run]);
    await use(logger);
  },
});

describe('LogClient#addLog (after start)', () => {
  it('should send one log', async ({ logger, server, expect }) => {
    let p = logger.addLog({
      type: 'mock-log',
      val: 1,
      date: new Date('2021-06-03T02:00:00.000Z'),
    });
    vi.runAllTimers();
    await p;
    await expect(server.waitForChangeRequests()).resolves.toEqual([
      {
        url: 'https://server.test/api/experiments/exp-name/runs/run-name/logs',
        method: 'POST',
        body: {
          logs: [
            {
              type: 'mock-log',
              values: { val: 1, date: '2021-06-03T02:00:00.000Z' },
              number: 1,
            },
          ],
        } satisfies ApiBody<
          'post',
          '/experiments/{experimentName}/runs/{runName}/logs'
        >,
      },
    ]);
  });

  it('should batch send multiple logs', async ({ logger, server }) => {
    let p = Promise.all([
      logger.addLog({
        type: 'mock-log',
        val: 1,
        date: new Date('2021-06-03T02:00:00.000Z'),
      }),
      logger.addLog({
        type: 'mock-log',
        val: 2,
        date: new Date('2021-06-03T02:00:10.000Z'),
      }),
      logger.addLog({
        type: 'mock-log',
        val: 3,
        date: new Date('2021-06-03T02:00:20.000Z'),
      }),
    ]);
    vi.runAllTimers();
    await p;
    await expect(server.waitForChangeRequests()).resolves.toEqual([
      {
        url: 'https://server.test/api/experiments/exp-name/runs/run-name/logs',
        method: 'POST',
        body: {
          logs: [
            {
              type: 'mock-log',
              number: 1,
              values: { val: 1, date: '2021-06-03T02:00:00.000Z' },
            },
            {
              type: 'mock-log',
              number: 2,
              values: { val: 2, date: '2021-06-03T02:00:10.000Z' },
            },
            {
              type: 'mock-log',
              number: 3,
              values: { val: 3, date: '2021-06-03T02:00:20.000Z' },
            },
          ],
        } satisfies ApiBody<
          'post',
          '/experiments/{experimentName}/runs/{runName}/logs'
        >,
      },
    ]);
  });

  it('should add a default date to logs sent alone', async ({
    logger,
    server,
  }) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime('2019-06-03T02:00:00.000Z');
    let p = logger.addLog({ type: 'mock-log', val: 1 });
    vi.runAllTimers();
    await p;
    await expect(server.waitForChangeRequests()).resolves.toEqual([
      {
        url: 'https://server.test/api/experiments/exp-name/runs/run-name/logs',
        method: 'POST',
        body: {
          logs: [
            {
              type: 'mock-log',
              values: { val: 1, date: '2019-06-03T02:00:00.000Z' },
              number: 1,
            },
          ],
        } satisfies ApiBody<
          'post',
          '/experiments/{experimentName}/runs/{runName}/logs'
        >,
      },
    ]);
  });

  it('should add a default date to logs sent in a batch', async ({
    logger,
    server,
  }) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime('2019-06-03T02:00:00.000Z');
    let p = logger.addLog({ type: 'mock-log', val: 1 });
    vi.setSystemTime('2019-06-03T02:00:00.100Z');
    p = logger.addLog({ type: 'mock-log', val: 2 });
    vi.runAllTimers();
    await p;
    await expect(server.waitForChangeRequests()).resolves.toEqual([
      {
        url: 'https://server.test/api/experiments/exp-name/runs/run-name/logs',
        method: 'POST',
        body: {
          logs: [
            {
              type: 'mock-log',
              values: { val: 1, date: '2019-06-03T02:00:00.000Z' },
              number: 1,
            },
            {
              type: 'mock-log',
              values: { val: 2, date: '2019-06-03T02:00:00.100Z' },
              number: 2,
            },
          ],
        } satisfies ApiBody<
          'post',
          '/experiments/{experimentName}/runs/{runName}/logs'
        >,
      },
    ]);
  });

  it('should send logs with no provided values', async ({ logger, server }) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime('2019-06-03T02:00:00.000Z');
    let p = logger.addLog({ type: 'mock-log' });
    vi.runAllTimers();
    await p;
    await expect(server.waitForChangeRequests()).resolves.toEqual([
      {
        url: 'https://server.test/api/experiments/exp-name/runs/run-name/logs',
        method: 'POST',
        body: {
          logs: [
            {
              type: 'mock-log',
              values: { date: '2019-06-03T02:00:00.000Z' },
              number: 1,
            },
          ],
        } satisfies ApiBody<
          'post',
          '/experiments/{experimentName}/runs/{runName}/logs'
        >,
      },
    ]);
  });
});

describe('LogClient#addLog (after resume)', () => {
  it('should properly start numbering after a run has been resumed', async ({
    server,
  }) => {
    server.setRuns([
      {
        experimentName: 'test-experiment',
        runName: 'test-run',
        runStatus: 'running',
        logs: [
          { type: 'test-type', count: 3, lastNumber: 4, pending: 2 },
          { type: 'other-type', count: 3, lastNumber: 6, pending: 0 },
        ],
      },
    ]);
    const logger = new LightmillLogger({
      fetchClient: createClient({ baseUrl: 'https://server.test/api' }),
      experimentName: 'test-experiment',
      runName: 'test-run',
      logCount: 4,
      requestThrottle: 4000,
      serializeLog: (log) => JSON.parse(JSON.stringify(log)),
    });
    let p = Promise.all([
      logger.addLog({
        type: 'mock-log',
        val: 1,
        date: new Date('2021-06-03T02:00:00.000Z'),
      }),
      logger.addLog({
        type: 'mock-log',
        val: 2,
        date: new Date('2021-06-03T02:00:10.000Z'),
      }),
      logger.addLog({
        type: 'mock-log',
        val: 3,
        date: new Date('2021-06-03T02:00:20.000Z'),
      }),
    ]);
    vi.runAllTimers();
    await p;
    await expect(server.waitForChangeRequests()).resolves.toEqual([
      {
        url: 'https://server.test/api/experiments/test-experiment/runs/test-run/logs',
        method: 'POST',
        body: {
          logs: [
            {
              type: 'mock-log',
              number: 5,
              values: { val: 1, date: '2021-06-03T02:00:00.000Z' },
            },
            {
              type: 'mock-log',
              number: 6,
              values: { val: 2, date: '2021-06-03T02:00:10.000Z' },
            },
            {
              type: 'mock-log',
              number: 7,
              values: { val: 3, date: '2021-06-03T02:00:20.000Z' },
            },
          ],
        } satisfies ApiBody<
          'post',
          '/experiments/{experimentName}/runs/{runName}/logs'
        >,
      },
    ]);
  });
});

describe('LogClient#flush', () => {
  it('should flush', async ({ logger, server }) => {
    logger.addLog({
      type: 'mock-log',
      val: 1,
      date: new Date('2021-06-03T02:00:00.000Z'),
    });
    logger.addLog({
      type: 'mock-log',
      val: 2,
      date: new Date('2021-06-03T03:00:00.000Z'),
    });
    logger.addLog({
      type: 'mock-log',
      val: 3,
      date: new Date('2021-06-03T04:00:00.000Z'),
    });
    // No timer this time, flush should send the request immediately.
    await logger.flush();
    await expect(server.waitForChangeRequests()).resolves.toEqual([
      {
        url: 'https://server.test/api/experiments/exp-name/runs/run-name/logs',
        method: 'POST',
        body: {
          logs: [
            {
              type: 'mock-log',
              number: 1,
              values: { val: 1, date: '2021-06-03T02:00:00.000Z' },
            },
            {
              type: 'mock-log',
              number: 2,
              values: { val: 2, date: '2021-06-03T03:00:00.000Z' },
            },
            {
              type: 'mock-log',
              number: 3,
              values: { val: 3, date: '2021-06-03T04:00:00.000Z' },
            },
          ],
        } satisfies ApiBody<
          'post',
          '/experiments/{experimentName}/runs/{runName}/logs'
        >,
      },
    ]);
  });
});

describe('LogClient#completeRun', () => {
  it('should complete', async ({ server, logger }) => {
    await logger.completeRun();
    await expect(server.waitForChangeRequests()).resolves.toEqual([
      {
        method: 'PATCH',
        url: 'https://server.test/api/experiments/exp-name/runs/run-name',
        body: { runStatus: 'completed' },
      },
    ]);
  });
});

describe('LogClient#cancelRun', () => {
  it('should cancel', async ({ server, logger }) => {
    await logger.cancelRun();
    await expect(server.waitForChangeRequests()).resolves.toEqual([
      {
        method: 'PATCH',
        url: 'https://server.test/api/experiments/exp-name/runs/run-name',
        body: { runStatus: 'canceled' },
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
