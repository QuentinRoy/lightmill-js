import { bypass, http, HttpResponse, passthrough } from 'msw';
import { beforeEach, describe, expect, vi } from 'vitest';
import { LightmillClient } from '../src/client.js';
import type { LoggerState } from '../src/logger.js';
import { serverTest, type TestServer } from './test-server.ts';
import {
  advanceUntilSettled,
  DeferManager,
  fakeDate,
  fakeTimers,
  readOperations,
  until,
} from './test-utils.ts';

type Logger = Awaited<ReturnType<LightmillClient['startRun']>>;

const experimentName = 'exp-name';
const runName = 'run-name';

const it = serverTest.extend<{ requestThrottle: number; logger: Logger }>({
  requestThrottle: 0,
  logger: async ({ server, requestThrottle }, use) => {
    await server.addExperiment(experimentName);
    const client = new LightmillClient({
      apiRoot: server.apiRoot,
      requestThrottle,
    });
    await use(await client.startRun({ experimentName, runName }));
  },
});

describe('LogClient#addLog', () => {
  it('should send one log', async ({ logger, server }) => {
    await logger.addLog({
      type: 'mock-log',
      val: 1,
      date: new Date('2021-06-03T02:00:00.000Z'),
    });
    await expect(storedLogs(server)).resolves.toEqual([
      {
        number: 1,
        type: 'mock-log',
        values: { date: '2021-06-03T02:00:00.000Z', val: 1 },
      },
    ]);
  });

  it('should add a default date to logs', async ({ logger, server }) => {
    fakeDate('2019-06-03T02:00:00.000Z');
    await logger.addLog({ type: 'mock-log', val: 'xxx' });
    await expect(storedLogs(server)).resolves.toEqual([
      {
        number: 1,
        type: 'mock-log',
        values: { date: '2019-06-03T02:00:00.000Z', val: 'xxx' },
      },
    ]);
  });

  it('should send logs with no provided values', async ({ logger, server }) => {
    fakeDate('2019-06-03T02:00:00.000Z');
    await logger.addLog({ type: 'mock-log' });
    await expect(storedLogs(server)).resolves.toEqual([
      {
        number: 1,
        type: 'mock-log',
        values: { date: '2019-06-03T02:00:00.000Z' },
      },
    ]);
  });
});

describe('LogClient#addLog (after resume)', () => {
  it('should properly start numbering after a run has been resumed', async ({
    logger,
    server,
  }) => {
    for (let val = 1; val <= 6; val++) {
      await logger.addLog({ type: 'mock-log', val: `old-${val}` });
    }
    await logger.interruptRun();
    // A page reload: a new client, with the same session cookie.
    const resumedLogger = await new LightmillClient({
      apiRoot: server.apiRoot,
    }).startRun({ experimentName, runName, after: { number: 4 } });
    await Promise.all([
      resumedLogger.addLog({
        type: 'mock-log',
        val: 'a',
        date: new Date('2021-06-03T02:00:00.000Z'),
      }),
      resumedLogger.addLog({
        type: 'mock-log',
        val: 'b',
        date: new Date('2021-06-03T02:00:10.000Z'),
      }),
      resumedLogger.addLog({
        type: 'mock-log',
        val: 'c',
        date: new Date('2021-06-03T02:00:20.000Z'),
      }),
    ]);
    const logs = await storedLogs(server);
    expect(logs.map(({ number, values }) => [number, values.val])).toEqual([
      [1, 'old-1'],
      [2, 'old-2'],
      [3, 'old-3'],
      [4, 'old-4'],
      [5, 'a'],
      [6, 'b'],
      [7, 'c'],
    ]);
  });
});

describe('LogClient#flush', () => {
  it('should flush', async ({ logger, server }) => {
    void logger.addLog({ type: 'mock-log', val: 1 });
    void logger.addLog({ type: 'mock-log', val: 2 });
    void logger.addLog({ type: 'mock-log', val: 3 });
    await logger.flush();
    await expect(storedNumbers(server)).resolves.toEqual([1, 2, 3]);
  });

  it('should flush even if flush is called multiple times', async ({
    logger,
    server,
  }) => {
    void logger.addLog({ type: 'mock-log', val: 1 });
    void logger.addLog({ type: 'mock-log', val: 2 });
    void logger.addLog({ type: 'mock-log', val: 3 });
    await expect(
      Promise.all([logger.flush(), logger.flush(), logger.flush()]),
    ).resolves.toEqual([undefined, undefined, undefined]);
    await expect(storedNumbers(server)).resolves.toEqual([1, 2, 3]);
  });

  it('ignores any log added after the call', async ({ logger, server }) => {
    const reqManager = holdOperations(server);
    void logger.addLog({ type: 'mock-log', val: 1 });
    void logger.addLog({ type: 'mock-log', val: 2 });
    let resolved = false;
    const flushPromise = logger.flush().then((result) => {
      resolved = true;
      return result;
    });
    await reqManager.waitForRequests(1);
    const lateLog = logger.addLog({ type: 'mock-log', val: 3 });
    expect(resolved).toBe(false);
    reqManager.resolveNextRequest();
    await expect(flushPromise).resolves.toBeUndefined();
    expect(resolved).toBe(true);
    await reqManager.waitForRequests(2);
    reqManager.resolveNextRequest();
    await lateLog;
    await expect(storedNumbers(server)).resolves.toEqual([1, 2, 3]);
  });

  it('ignores log errors added after the call, but not before', async ({
    logger,
    server,
  }) => {
    const defManager = new DeferManager();
    server.msw.use(
      http.post(server.url('/operations'), async ({ request }) => {
        const operations = await readOperations(request);
        await defManager.addRequest();
        if (operations.some((op) => op.data.attributes.values.val === 'fail')) {
          return HttpResponse.json(
            { errors: [{ status: 'Forbidden', code: 'RUN_NOT_FOUND' }] },
            { status: 403 },
          );
        }
        return passthrough();
      }),
      http.get(server.url('/runs/:id'), async ({ request }) => {
        const response = await fetch(bypass(request));
        const body = await response.json();
        // Past the last log the first flush call waits for, so it ignores it.
        body.data.attributes.firstMissingLogNumber = 3;
        return HttpResponse.json(body);
      }),
    );
    void logger.addLog({ type: 'mock-log', val: 1 });
    void logger.addLog({ type: 'mock-log', val: 2 });
    const flushPromise = logger.flush();
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
      `[RequestError: RUN_NOT_FOUND]`,
    );
  });

  it('fails if there are still missing log numbers on the server', async ({
    logger,
    server,
  }) => {
    // The server answers that it stored log 1, but never receives it.
    server.msw.use(
      http.post(
        server.url('/operations'),
        async ({ request }) => {
          const operations = await readOperations(request);
          return HttpResponse.json({
            'atomic:results': operations.map(() => ({
              data: { id: 'lost', type: 'logs' },
            })),
          });
        },
        { once: true },
      ),
    );
    await logger.addLog({ type: 'mock-log', val: 1 });
    void logger.addLog({ type: 'mock-log', val: 2 });
    await expect(logger.flush()).rejects.toThrowErrorMatchingInlineSnapshot(
      `[FlushError: Log number 1 is missing on the server after flushing. Add it if you still have it; otherwise resume the run after log number 0 (this cancels later logs).]`,
    );
  });
});

describe('LogClient batches', () => {
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
    await expect(server.operationBatches()).resolves.toEqual([
      [1, 2],
      [3],
      [4],
      [5],
    ]);
    await expect(storedNumbers(server)).resolves.toEqual([1, 2, 3, 4, 5]);
  });

  it('rejects every log of a failed batch', async ({ logger, server }) => {
    server.msw.use(
      http.post(server.url('/operations'), () =>
        HttpResponse.json(
          { errors: [{ status: 'Forbidden', code: 'RUN_NOT_FOUND' }] },
          { status: 403 },
        ),
      ),
    );
    const results = await Promise.allSettled([
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
    expect(logger.state).toEqual({
      status: 'paused',
      error: expect.objectContaining({ status: 403 }),
    });
  });

  it('does not use a log number when serializing fails', async ({ server }) => {
    await server.addExperiment(experimentName);
    const logger = await new LightmillClient<{ type: string; fail?: boolean }>({
      apiRoot: server.apiRoot,
      serializeLog: (x) => {
        if (x.fail) throw new Error('Cannot serialize');
        return JSON.parse(JSON.stringify(x));
      },
    }).startRun({ experimentName, runName });
    await expect(
      logger.addLog({ type: 'mock-log', fail: true }),
    ).rejects.toThrow('Cannot serialize');
    await logger.addLog({ type: 'mock-log' });
    await expect(storedNumbers(server)).resolves.toEqual([1]);
  });
});

describe('LogClient batches (timing)', () => {
  beforeEach(fakeTimers);
  const throttledIt = it.extend({ requestThrottle: 1000 });

  it('sends the logs added while a batch is in flight in the next batch', async ({
    logger,
    server,
  }) => {
    const reqManager = holdOperations(server);
    const p1 = logger.addLog({ type: 'mock-log' });
    await reqManager.waitForRequests(1);
    const p2 = logger.addLog({ type: 'mock-log' });
    const p3 = logger.addLog({ type: 'mock-log' });
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
    await expect(server.operationBatches()).resolves.toEqual([[1], [2, 3]]);
    await expect(storedNumbers(server)).resolves.toEqual([1, 2, 3]);
  });

  throttledIt(
    'waits requestThrottle between batch starts, except when flushing',
    async ({ logger, server }) => {
      await logger.addLog({ type: 'mock-log' });
      const p2 = logger.addLog({ type: 'mock-log' });
      await vi.advanceTimersByTimeAsync(900);
      await expect(server.operationBatches()).resolves.toEqual([[1]]);
      await vi.advanceTimersByTimeAsync(100);
      await p2;
      await expect(server.operationBatches()).resolves.toEqual([[1], [2]]);
      void logger.addLog({ type: 'mock-log' });
      await logger.flush();
      await expect(server.operationBatches()).resolves.toEqual([[1], [2], [3]]);
    },
  );

  throttledIt(
    'sends the next batch at once when flushing during a batch',
    async ({ logger, server }) => {
      const reqManager = holdOperations(server);
      void logger.addLog({ type: 'mock-log' });
      await reqManager.waitForRequests(1);
      void logger.addLog({ type: 'mock-log' });
      const flushPromise = logger.flush();
      reqManager.resolveNextRequest();
      await reqManager.waitForRequests(2);
      reqManager.resolveNextRequest();
      await expect(flushPromise).resolves.toBeUndefined();
      await expect(server.operationBatches()).resolves.toEqual([[1], [2]]);
    },
  );
});

describe('LogClient server errors', () => {
  it('gives up at once when Retry-After ends past two minutes', async ({
    logger,
    server,
  }) => {
    server.msw.use(
      http.post(server.url('/operations'), () =>
        respond(503, { headers: { 'Retry-After': '3600' } }),
      ),
    );
    await expect(logger.addLog({ type: 'mock-log' })).rejects.toMatchObject({
      name: 'AddLogError',
    });
    expect(logger.state).toMatchObject({ status: 'paused' });
  });

  // openapi-fetch reports a failed response with `Content-Length: 0` apart.
  for (const [title, init] of [
    ['halves a batch that gets a 413', undefined],
    [
      'halves a batch that gets a 413 with no body',
      { headers: { 'Content-Length': '0' } },
    ],
  ] as const) {
    it(title, async ({ logger, server }) => {
      server.msw.use(
        http.post(server.url('/operations'), async ({ request }) => {
          const operations = await readOperations(request);
          return operations.length > 2 ? respond(413, init) : passthrough();
        }),
      );
      await Promise.all([
        logger.addLog({ type: 'mock-log' }),
        logger.addLog({ type: 'mock-log' }),
        logger.addLog({ type: 'mock-log' }),
        logger.addLog({ type: 'mock-log' }),
      ]);
      await expect(server.operationBatches()).resolves.toEqual([
        [1, 2, 3, 4],
        [1, 2],
        [3, 4],
      ]);
      await expect(storedNumbers(server)).resolves.toEqual([1, 2, 3, 4]);
    });
  }

  it('pauses when a single log gets a 413', async ({ logger, server }) => {
    server.msw.use(http.post(server.url('/operations'), () => respond(413)));
    await expect(logger.addLog({ type: 'mock-log' })).rejects.toMatchObject({
      name: 'AddLogError',
    });
    expect(logger.state).toMatchObject({ status: 'paused' });
  });

  it('reports a server without POST /operations', async ({
    logger,
    server,
  }) => {
    server.msw.use(http.post(server.url('/operations'), () => respond(404)));
    await expect(
      logger.addLog({ type: 'mock-log' }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[AddLogError: The server does not serve POST /operations. Update @lightmill/log-server.]`,
    );
  });

  it('pauses when the server answers with the wrong number of results', async ({
    logger,
    server,
  }) => {
    server.msw.use(
      http.post(server.url('/operations'), () =>
        HttpResponse.json({ 'atomic:results': [] }),
      ),
    );
    await expect(
      logger.addLog({ type: 'mock-log' }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[AddLogError: The server answered a batch of 1 logs with 0 results]`,
    );
    expect(logger.state).toMatchObject({ status: 'paused' });
  });

  it('accepts logs again after ending the run fails', async ({
    logger,
    server,
  }) => {
    failOnce(server, 'patch', '/runs/:id', () => respond(403));
    await expect(logger.completeRun()).rejects.toMatchObject({ status: 403 });
    await expect(logger.addLog({ type: 'mock-log' })).resolves.toBeUndefined();
  });

  it('aborts the batch being sent when discarding in-flight logs', async ({
    logger,
    server,
  }) => {
    const signals: AbortSignal[] = [];
    failOnce(server, 'post', '/operations', ({ request }) => {
      signals.push(request.signal);
      return new Promise<never>(() => {});
    });
    failOnce(server, 'patch', '/runs/:id', () => respond(403));
    const log = logger.addLog({ type: 'mock-log' }).catch((e) => e);
    await until(() => signals.length === 1);
    await expect(
      logger.cancelRun({ discardInFlightLogs: true }),
    ).rejects.toMatchObject({ status: 403 });
    expect(signals[0]?.aborted).toBe(true);
    await expect(log).resolves.toMatchObject({ name: 'AddLogError' });
  });
});

describe('LogClient retries', () => {
  beforeEach(() => {
    // Makes every backoff delay its maximum: 250 ms, 500 ms, 1 s, ...
    const random = vi.spyOn(Math, 'random').mockReturnValue(1);
    return () => random.mockRestore();
  });
  beforeEach(fakeTimers);

  it('retries a batch that fails with a 5xx', async ({ logger, server }) => {
    failOnce(server, 'post', '/operations', () => respond(503));
    const states: LoggerState[] = [];
    logger.subscribe((state) => states.push(state));
    const p1 = logger.addLog({ type: 'mock-log' });
    await until(() => logger.state.status === 'retrying');
    await vi.advanceTimersByTimeAsync(249);
    await expect(server.operationBatches()).resolves.toEqual([[1]]);
    await vi.advanceTimersByTimeAsync(1);
    await expect(p1).resolves.toBeUndefined();
    await expect(server.operationBatches()).resolves.toEqual([[1], [1]]);
    await expect(storedNumbers(server)).resolves.toEqual([1]);
    expect(states).toEqual([
      { status: 'sending' },
      {
        status: 'retrying',
        error: expect.objectContaining({ status: 503 }),
        attempt: 1,
        delayMs: 250,
      },
      { status: 'idle' },
    ]);
  });

  it('waits for Retry-After on a 429', async ({ logger, server }) => {
    failOnce(server, 'post', '/operations', () =>
      respond(429, { headers: { 'Retry-After': '5' } }),
    );
    const p1 = logger.addLog({ type: 'mock-log' });
    await until(() => logger.state.status === 'retrying');
    await vi.advanceTimersByTimeAsync(4999);
    expect(server.requestCount('POST', '/operations')).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(p1).resolves.toBeUndefined();
    expect(server.requestCount('POST', '/operations')).toBe(2);
  });

  it('keeps the backoff when Retry-After is shorter', async ({
    logger,
    server,
  }) => {
    failOnce(server, 'post', '/operations', () =>
      respond(503, { headers: { 'Retry-After': '0' } }),
    );
    const p1 = logger.addLog({ type: 'mock-log' });
    await until(() => logger.state.status === 'retrying');
    await vi.advanceTimersByTimeAsync(249);
    expect(server.requestCount('POST', '/operations')).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(p1).resolves.toBeUndefined();
  });

  it('retries after a network error', async ({ logger, server }) => {
    failOnce(server, 'post', '/operations', () => HttpResponse.error());
    const p1 = logger.addLog({ type: 'mock-log' });
    await advanceUntilSettled(p1);
    expect(server.requestCount('POST', '/operations')).toBe(2);
  });

  it('retries a request the server does not answer in time', async ({
    logger,
    server,
  }) => {
    failOnce(server, 'post', '/operations', () => new Promise(() => {}));
    const p1 = logger.addLog({ type: 'mock-log' });
    await until(() => server.requestCount('POST', '/operations') === 1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(server.requestCount('POST', '/operations')).toBe(1);
    // The log is under 1 kB, so the timeout is under 10.1 s.
    await vi.advanceTimersByTimeAsync(100 + 250);
    await expect(p1).resolves.toBeUndefined();
    expect(server.requestCount('POST', '/operations')).toBe(2);
  });

  it('pauses and holds logs after two minutes of failures, until retry()', async ({
    logger,
    server,
  }) => {
    server.msw.use(http.post(server.url('/operations'), () => respond(503)));
    const r1 = logger.addLog({ type: 'mock-log', val: 1 }).catch((e) => e);
    await vi.advanceTimersByTimeAsync(0);
    let p2Resolved = false;
    const p2 = logger.addLog({ type: 'mock-log', val: 2 }).then(() => {
      p2Resolved = true;
    });
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    await expect(r1).resolves.toMatchObject({
      name: 'AddLogError',
      logNumber: 1,
      cause: expect.objectContaining({ status: 503 }),
    });
    expect(logger.state).toEqual({
      status: 'paused',
      error: expect.objectContaining({ status: 503 }),
    });
    expect(logger.inFlightLogs).toEqual([
      { type: 'mock-log', val: 1 },
      { type: 'mock-log', val: 2 },
    ]);
    const callCount = server.requestCount('POST', '/operations');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(server.requestCount('POST', '/operations')).toBe(callCount);
    await expect(logger.flush()).rejects.toMatchObject({ status: 503 });
    await expect(logger.completeRun()).rejects.toMatchObject({ status: 503 });
    expect(p2Resolved).toBe(false);

    // The server is back.
    server.msw.resetHandlers();
    await expect(logger.retry()).resolves.toBeUndefined();
    await expect(p2).resolves.toBeUndefined();
    expect((await server.operationBatches()).at(-1)).toEqual([1, 2]);
    await expect(storedNumbers(server)).resolves.toEqual([1, 2]);
    expect(logger.state).toEqual({ status: 'idle' });
    expect(logger.inFlightLogs).toEqual([]);
    await expect(logger.flush()).resolves.toBeUndefined();
  });

  it('retries ending a run', async ({ logger, server }) => {
    failOnce(server, 'patch', '/runs/:id', () => respond(503));
    await advanceUntilSettled(logger.completeRun());
    expect(server.requestCount('PATCH', /^\/runs\//)).toBe(2);
    await expect(runStatuses(server)).resolves.toEqual(['completed']);
  });

  it('refuses logs and other end calls while the run is ending', async ({
    logger,
    server,
  }) => {
    failOnce(server, 'patch', '/runs/:id', () => respond(503));
    const completion = logger.completeRun();
    await vi.advanceTimersByTimeAsync(0);
    await expect(logger.addLog({ type: 'mock-log' })).rejects.toThrow(
      'Cannot add logs while the run is ending',
    );
    await expect(logger.cancelRun()).rejects.toThrow(
      'The run is already ending',
    );
    await advanceUntilSettled(completion);
    await expect(completion).resolves.toBeUndefined();
  });

  it('only ends a paused run when asked to discard in-flight logs', async ({
    logger,
    server,
  }) => {
    server.msw.use(http.post(server.url('/operations'), () => respond(503)));
    const r1 = logger.addLog({ type: 'mock-log' }).catch((e) => e);
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    await r1;
    const r2 = logger.addLog({ type: 'mock-log' }).catch((e) => e);
    await expect(logger.cancelRun()).rejects.toMatchObject({ status: 503 });
    await expect(
      advanceUntilSettled(logger.cancelRun({ discardInFlightLogs: true })),
    ).resolves.toBeUndefined();
    await expect(r2).resolves.toMatchObject({
      name: 'AddLogError',
      logNumber: 2,
    });
    expect(logger.inFlightLogs).toEqual([]);
    expect(logger.state).toEqual({ status: 'canceled' });
    await expect(runStatuses(server)).resolves.toEqual(['canceled']);
  });
});

describe('LogClient#completeRun', () => {
  it('should complete', async ({ server, logger }) => {
    await logger.completeRun();
    await expect(runStatuses(server)).resolves.toEqual(['completed']);
  });
});

describe('LogClient#cancelRun', () => {
  it('should cancel', async ({ server, logger }) => {
    await logger.cancelRun();
    await expect(runStatuses(server)).resolves.toEqual(['canceled']);
  });
});

// The first request to `path` is answered here, the others by the server.
function failOnce(
  server: TestServer,
  method: 'post' | 'patch',
  path: string,
  resolver: Parameters<typeof http.post>[1],
) {
  server.msw.use(http[method](server.url(path), resolver, { once: true }));
}

function respond(status: number, init?: ResponseInit) {
  return new HttpResponse(null, { ...init, status });
}

// Holds every POST /operations until the test lets it through to the server.
function holdOperations(server: TestServer) {
  const held = new DeferManager();
  server.msw.use(
    http.post(server.url('/operations'), async () => {
      await held.addRequest();
      return passthrough();
    }),
  );
  return held;
}

async function storedLogs(server: TestServer) {
  return (await server.storedLogs()).map(({ number, type, values }) => ({
    number,
    type,
    values,
  }));
}

async function storedNumbers(server: TestServer) {
  return (await storedLogs(server)).map((log) => log.number);
}

async function runStatuses(server: TestServer) {
  return (await server.dataStore.getRuns()).map((run) => run.runStatus);
}
