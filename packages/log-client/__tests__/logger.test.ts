import type { paths } from '@lightmill/log-api';
import createClient from 'openapi-fetch';
import { describe, expect, vi } from 'vitest';
import { serverTest } from '../__mocks__/mock-server.js';
import { LightmillLogger } from '../src/logger.js';

const it = serverTest.extend<{
  timer: void;
  logger: LightmillLogger;
  run: {
    experimentName: string;
    runName: string;
    experimentId: string;
    runId: string;
  };
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
  run: Object.freeze({
    experimentName: 'exp-name',
    experimentId: 'exp-id',
    runName: 'run-name',
    runId: 'run-id',
  }),
  logger: async ({ server, run }, use) => {
    const fetchClient = createClient<paths>({
      baseUrl: server.getBaseUrl(),
      headers: { accept: 'application/json' },
    });
    const logger = new LightmillLogger({
      fetchClient,
      ...run,
      lastLogNumber: 0,
      serializeLog: (x) => JSON.parse(JSON.stringify(x)),
    });
    server.set([run]);
    await use(logger);
    server.reset();
  },
  resumedLogCount: 100,
  resumedLogger: async ({ server, resumedLogCount, run }, use) => {
    const fetchClient = createClient<paths>({ baseUrl: server.getBaseUrl() });
    const logger = new LightmillLogger({
      fetchClient,
      ...run,
      lastLogNumber: resumedLogCount,
      serializeLog: (x) => JSON.parse(JSON.stringify(x)),
    });
    server.set([run]);
    await use(logger);
    server.reset();
  },
});

describe('LogClient#addLog', () => {
  it('should send one log', async ({ logger, server, expect }) => {
    await logger.addLog({
      type: 'mock-log',
      val: 1,
      date: new Date('2021-06-03T02:00:00.000Z'),
    });
    await expect(server.waitForChangeRequests()).resolves
      .toMatchInlineSnapshot(`
      [
        {
          "body": {
            "data": {
              "attributes": {
                "logType": "mock-log",
                "number": 1,
                "values": {
                  "date": "2021-06-03T02:00:00.000Z",
                  "val": 1,
                },
              },
              "relationships": {
                "run": {
                  "data": {
                    "id": "run-id",
                    "type": "runs",
                  },
                },
              },
              "type": "logs",
            },
          },
          "method": "POST",
          "url": "https://server.test/api/logs",
        },
      ]
    `);
  });

  it('should add a default date to logs ', async ({ logger, server }) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime('2019-06-03T02:00:00.000Z');
    await logger.addLog({ type: 'mock-log', val: 'xxx' });
    await expect(server.waitForChangeRequests()).resolves
      .toMatchInlineSnapshot(`
        [
          {
            "body": {
              "data": {
                "attributes": {
                  "logType": "mock-log",
                  "number": 1,
                  "values": {
                    "date": "2019-06-03T02:00:00.000Z",
                    "val": "xxx",
                  },
                },
                "relationships": {
                  "run": {
                    "data": {
                      "id": "run-id",
                      "type": "runs",
                    },
                  },
                },
                "type": "logs",
              },
            },
            "method": "POST",
            "url": "https://server.test/api/logs",
          },
        ]
    `);
  });

  it('should send logs with no provided values', async ({ logger, server }) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime('2019-06-03T02:00:00.000Z');
    await logger.addLog({ type: 'mock-log' });
    await expect(server.waitForChangeRequests()).resolves
      .toMatchInlineSnapshot(`
      [
        {
          "body": {
            "data": {
              "attributes": {
                "logType": "mock-log",
                "number": 1,
                "values": {
                  "date": "2019-06-03T02:00:00.000Z",
                },
              },
              "relationships": {
                "run": {
                  "data": {
                    "id": "run-id",
                    "type": "runs",
                  },
                },
              },
              "type": "logs",
            },
          },
          "method": "POST",
          "url": "https://server.test/api/logs",
        },
      ]
    `);
  });
});

describe('LogClient#addLog (after resume)', () => {
  it('should properly start numbering after a run has been resumed', async ({
    server,
  }) => {
    server.set([
      {
        experimentId: 'test-experiment',
        runId: 'test-run',
        runStatus: 'running',
        lastLogs: [
          { type: 'test-type', number: 4 },
          { type: 'other-type', number: 6 },
        ],
      },
    ]);
    const logger = new LightmillLogger({
      fetchClient: createClient({
        baseUrl: 'https://server.test/api',
        headers: { contentType: 'application/vnd.api+json' },
      }),
      runId: 'test-run',
      lastLogNumber: 4,
      serializeLog: (log) => JSON.parse(JSON.stringify(log)),
    });
    await Promise.all([
      logger.addLog({
        type: 'mock-log',
        val: 'a',
        date: new Date('2021-06-03T02:00:00.000Z'),
      }),
      logger.addLog({
        type: 'mock-log',
        val: 'b',
        date: new Date('2021-06-03T02:00:10.000Z'),
      }),
      logger.addLog({
        type: 'mock-log',
        val: 'c',
        date: new Date('2021-06-03T02:00:20.000Z'),
      }),
    ]);
    await expect(server.waitForChangeRequests()).resolves.toMatchSnapshot();
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
    await logger.flush();
    await expect(server.waitForChangeRequests()).resolves.toMatchSnapshot();
  });

  it('should flush even if flush is called multiple times', async ({
    logger,
    server,
  }) => {
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
    let flush1 = logger.flush();
    let flush2 = logger.flush();
    let flush3 = logger.flush();
    await expect(
      Promise.all([flush1, flush2, flush3]),
    ).resolves.toMatchSnapshot();
    await expect(server.waitForChangeRequests()).resolves.toMatchSnapshot();
  });
});

describe('LogClient#completeRun', () => {
  it('should complete', async ({ server, logger }) => {
    await logger.completeRun();
    await expect(server.waitForChangeRequests()).resolves
      .toMatchInlineSnapshot(`
      [
        {
          "body": {
            "data": {
              "attributes": {
                "status": "completed",
              },
              "id": "run-id",
              "type": "runs",
            },
          },
          "method": "PATCH",
          "url": "https://server.test/api/runs/run-id",
        },
      ]
    `);
  });
});

describe('LogClient#cancelRun', () => {
  it('should cancel', async ({ server, logger }) => {
    await logger.cancelRun();
    await expect(server.waitForChangeRequests()).resolves
      .toMatchInlineSnapshot(`
      [
        {
          "body": {
            "data": {
              "attributes": {
                "status": "canceled",
              },
              "id": "run-id",
              "type": "runs",
            },
          },
          "method": "PATCH",
          "url": "https://server.test/api/runs/run-id",
        },
      ]
    `);
  });
});
