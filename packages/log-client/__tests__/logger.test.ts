import type { paths } from '@lightmill/log-api';
import createClient from 'openapi-fetch';
import { describe, expect, vi } from 'vitest';
import { MockServer, serverTest } from '../__mocks__/mock-server.js';
import { LightmillLogger } from '../src/logger.js';
import { DeferManager } from './test-utils.ts';

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
            "atomic:operations": [
              {
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
                "op": "add",
              },
            ],
          },
          "method": "POST",
          "url": "https://server.test/api/operations",
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
            "atomic:operations": [
              {
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
                "op": "add",
              },
            ],
          },
          "method": "POST",
          "url": "https://server.test/api/operations",
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
            "atomic:operations": [
              {
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
                "op": "add",
              },
            ],
          },
          "method": "POST",
          "url": "https://server.test/api/operations",
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

  it('ignores any log added after the call', async ({ logger, server }) => {
    const reqManager = new DeferManager();
    server.handlers['/operations'].post.mockImplementation(({ body }) => {
      return reqManager.addRequest(okOperationsResponse(body));
    });
    logger.addLog({ type: 'mock-log', val: 1 });
    logger.addLog({ type: 'mock-log', val: 2 });
    let resolved = false;
    let flushPromise = logger.flush().then((result) => {
      resolved = true;
      return result;
    });
    await reqManager.waitForRequests(1);
    logger.addLog({ type: 'mock-log', val: 3 });
    expect(resolved).toBe(false);
    reqManager.resolveNextRequest();
    await expect(flushPromise).resolves.toBeUndefined();
    expect(resolved).toBe(true);
    await reqManager.waitForRequests(2);
    reqManager.resolveNextRequest();
  });

  it('ignores log errors added after the call, but not before', async ({
    logger,
    server,
  }) => {
    const defManager = new DeferManager();
    server.handlers['/operations'].post.mockImplementation(({ body }) => {
      if (
        body['atomic:operations'].some(
          (op) => op.data.attributes.values.val === 'fail',
        )
      ) {
        return defManager.addRequest({
          status: 403,
          body: { errors: [{ status: 'Forbidden', code: 'RUN_NOT_FOUND' }] },
        });
      }
      return defManager.addRequest(okOperationsResponse(body));
    });
    let oldGetRun = server.handlers['/runs/{id}'].get.getMockImplementation()!;
    server.handlers['/runs/{id}'].get.mockImplementation(async (...args) => {
      let result = await oldGetRun(...args);
      if (result.status !== 200) return result;
      result.body.data.attributes = {
        ...result.body.data.attributes,
        // Should be ignored by first flush call.
        firstMissingLogNumber: 3,
      };
      return result;
    });
    logger.addLog({ type: 'mock-log', val: 1 });
    logger.addLog({ type: 'mock-log', val: 2 });
    let flushPromise = logger.flush();
    await defManager.waitForRequests(1);
    logger.addLog({ type: 'mock-log', val: 'fail' }).catch(() => {
      // Prevent vitest from catching the error and complaining about it.
    });
    logger.addLog({ type: 'mock-log', val: 4 }).catch(() => {});
    defManager.resolveNextRequest();
    await defManager.waitForRequests(2);
    defManager.resolveNextRequest();
    await expect(flushPromise).resolves.toBeUndefined();
    await expect(logger.flush()).rejects.toThrowErrorMatchingInlineSnapshot(
      `[AddLogError: RUN_NOT_FOUND]`,
    );
  });

  it('fails if there are still missing logs on the server', async ({
    logger,
    server,
  }) => {
    let oldGetRun = server.handlers['/runs/{id}'].get.getMockImplementation()!;
    server.handlers['/runs/{id}'].get.mockImplementation(async (...args) => {
      let result = await oldGetRun(...args);
      if (result.status !== 200) return result;
      result.body.data.attributes = {
        ...result.body.data.attributes,
        firstMissingLogNumber: 1,
      };
      return result;
    });
    logger.addLog({ type: 'mock-log', val: 1 });
    logger.addLog({ type: 'mock-log', val: 2 });
    await expect(logger.flush()).rejects.toThrowErrorMatchingInlineSnapshot(
      `[FlushError: Log number 1 is missing on the server after flushing. Add it if you still have it; otherwise resume the run after log number 0 (this cancels later logs).]`,
    );
  });
});

describe('LogClient batches', () => {
  it('sends the logs added while a batch is in flight in the next batch', async ({
    logger,
    server,
  }) => {
    const reqManager = new DeferManager();
    server.handlers['/operations'].post.mockImplementation(({ body }) => {
      return reqManager.addRequest(okOperationsResponse(body));
    });
    let p1 = logger.addLog({ type: 'mock-log' });
    await reqManager.waitForRequests(1);
    let p2 = logger.addLog({ type: 'mock-log' });
    let p3 = logger.addLog({ type: 'mock-log' });
    await vi.advanceTimersByTimeAsync(1000);
    expect(reqManager.count()).toBe(1);
    reqManager.resolveNextRequest();
    await expect(p1).resolves.toBeUndefined();
    await reqManager.waitForRequests(2);
    reqManager.resolveNextRequest();
    await expect(Promise.all([p2, p3])).resolves.toEqual([
      undefined,
      undefined,
    ]);
    expect(getBatches(server)).toEqual([[1], [2, 3]]);
  });

  it('closes a batch at 512 kB of serialized operations', async ({
    logger,
    server,
  }) => {
    const big = 'x'.repeat(200 * 1024);
    const huge = 'x'.repeat(600 * 1024);
    await Promise.all([
      logger.addLog({ type: 'mock-log', big }),
      logger.addLog({ type: 'mock-log', big }),
      logger.addLog({ type: 'mock-log', big }),
      logger.addLog({ type: 'mock-log', huge }),
      logger.addLog({ type: 'mock-log' }),
    ]);
    expect(getBatches(server)).toEqual([[1, 2], [3], [4], [5]]);
  });

  it('waits requestThrottle between batch starts, except when flushing', async ({
    server,
    run,
  }) => {
    const logger = new LightmillLogger({
      fetchClient: createClient<paths>({ baseUrl: server.getBaseUrl() }),
      ...run,
      lastLogNumber: 0,
      serializeLog: (x) => JSON.parse(JSON.stringify(x)),
      requestThrottle: 1000,
    });
    server.set([run]);
    await logger.addLog({ type: 'mock-log' });
    let p2 = logger.addLog({ type: 'mock-log' });
    await vi.advanceTimersByTimeAsync(900);
    expect(getBatches(server)).toEqual([[1]]);
    await vi.advanceTimersByTimeAsync(100);
    await p2;
    expect(getBatches(server)).toEqual([[1], [2]]);
    logger.addLog({ type: 'mock-log' });
    await logger.flush();
    expect(getBatches(server)).toEqual([[1], [2], [3]]);
  });

  it('sends the next batch at once when flushing during a batch', async ({
    server,
    run,
  }) => {
    const logger = new LightmillLogger({
      fetchClient: createClient<paths>({ baseUrl: server.getBaseUrl() }),
      ...run,
      lastLogNumber: 0,
      serializeLog: (x) => JSON.parse(JSON.stringify(x)),
      requestThrottle: 1000,
    });
    server.set([run]);
    const reqManager = new DeferManager();
    server.handlers['/operations'].post.mockImplementation(({ body }) => {
      return reqManager.addRequest(okOperationsResponse(body));
    });
    logger.addLog({ type: 'mock-log' });
    await reqManager.waitForRequests(1);
    logger.addLog({ type: 'mock-log' });
    const flushPromise = logger.flush();
    reqManager.resolveNextRequest();
    await reqManager.waitForRequests(2);
    reqManager.resolveNextRequest();
    await expect(flushPromise).resolves.toBeUndefined();
    expect(getBatches(server)).toEqual([[1], [2]]);
  });

  it('rejects every log of a failed batch', async ({ logger, server }) => {
    server.handlers['/operations'].post.mockImplementation(async () => ({
      status: 403,
      body: { errors: [{ status: 'Forbidden', code: 'RUN_NOT_FOUND' }] },
    }));
    let results = await Promise.allSettled([
      logger.addLog({ type: 'mock-log' }),
      logger.addLog({ type: 'mock-log' }),
    ]);
    expect(results).toEqual([
      {
        status: 'rejected',
        reason: expect.objectContaining({
          name: 'AddLogError',
          message: 'RUN_NOT_FOUND',
          logNumber: 1,
        }),
      },
      {
        status: 'rejected',
        reason: expect.objectContaining({
          name: 'AddLogError',
          message: 'RUN_NOT_FOUND',
          logNumber: 2,
        }),
      },
    ]);
  });

  it('does not use a log number when serializing fails', async ({
    server,
    run,
  }) => {
    const logger = new LightmillLogger<{ type: string; fail?: boolean }>({
      fetchClient: createClient<paths>({ baseUrl: server.getBaseUrl() }),
      ...run,
      lastLogNumber: 0,
      serializeLog: (x) => {
        if (x.fail) throw new Error('Cannot serialize');
        return JSON.parse(JSON.stringify(x));
      },
    });
    server.set([run]);
    await expect(
      logger.addLog({ type: 'mock-log', fail: true }),
    ).rejects.toThrow('Cannot serialize');
    await logger.addLog({ type: 'mock-log' });
    expect(getBatches(server)).toEqual([[1]]);
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

function okOperationsResponse(body: {
  'atomic:operations': Array<{ data: { attributes: { number: number } } }>;
}) {
  return {
    status: 200 as const,
    body: {
      'atomic:results': body['atomic:operations'].map((op) => ({
        data: { id: `log-${op.data.attributes.number}`, type: 'logs' as const },
      })),
    },
  };
}

function getBatches(server: MockServer) {
  return server.handlers['/operations'].post.mock.calls.map(([{ body }]) =>
    body['atomic:operations'].map((op) => op.data.attributes.number),
  );
}
