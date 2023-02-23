import { LogClient } from '../src/main.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { afterAll, afterEach, beforeAll } from 'vitest';
import type { Response as ApiResponse } from '@lightmill/log-server';
import { setupServer } from 'msw/node';
import { rest } from 'msw';

const server = setupServer(
  rest.post(
    'https://server.test/api/experiments/experiment-id/runs/run-id/logs',
    (req, res, ctx) => {
      return res(
        ctx.status(200),
        ctx.json({ status: 'ok' } satisfies ApiResponse<
          'post',
          '/experiments/:experiment/runs/:run/logs'
        >)
      );
    }
  ),
  rest.post(
    'https://server.test/api/experiments/runs',
    async (req, res, ctx) => {
      return res(
        ctx.status(200),
        ctx.json({
          status: 'ok',
          run: 'run-id',
          experiment: 'experiment-id',
          links: {
            logs: '/experiments/experiment-id/runs/run-id/logs',
            run: '/experiments/experiment-id/runs/run-id',
          },
        } satisfies ApiResponse<'post', '/experiments/runs'>)
      );
    }
  ),
  rest.put(
    'https://server.test/api/experiments/experiment-id/runs/run-id',
    (req, res, ctx) => {
      return res(
        ctx.status(200),
        ctx.json({ status: 'ok' } satisfies ApiResponse<
          'put',
          '/experiments/:experiment/runs/:run'
        >)
      );
    }
  )
);

let requests: Array<{ url: string; method: string }> = [];
let requestBodies: Array<Promise<string>> = [];

async function waitForRequestJsonBodies() {
  let bodies = await Promise.all(requestBodies);
  return bodies
    .map((body) => JSON.parse(body))
    .map((body, i) => ({
      body,
      ...requests[i],
    }));
}

function clearRequests() {
  requests = [];
  requestBodies = [];
}

// Start server before all tests.
beforeAll(() => server.listen());

// Close server after all tests.
afterAll(() => server.close());

beforeEach(() => {
  vi.useFakeTimers();
  server.events.on('request:start', (req) => {
    requests.push({
      url: req.url.toString(),
      method: req.method,
    });
    requestBodies.push(req.text());
  });
});

// Reset handlers after each test `important for test isolation`.
afterEach(() => {
  vi.restoreAllMocks();
  server.resetHandlers();
  server.events.removeAllListeners();
  clearRequests();
});

describe('RunLogger', () => {
  it('should send a start request', async () => {
    const logger = new LogClient({
      apiRoot: 'https://server.test/api',
    });
    await logger.startRun();
    expect(await waitForRequestJsonBodies()).toEqual([
      {
        url: 'https://server.test/api/experiments/runs',
        method: 'POST',
        body: {},
      },
    ]);
  });

  it('should send a start request with parameters', async () => {
    const logger = new LogClient({
      apiRoot: 'https://server.test/api',
      run: 'test-run',
      experiment: 'test-experiment',
    });
    await logger.startRun();

    expect(await waitForRequestJsonBodies()).toEqual([
      {
        url: 'https://server.test/api/experiments/runs',
        method: 'POST',
        body: { id: 'test-run', experiment: 'test-experiment' },
      },
    ]);
  });

  it('should send one log', async () => {
    const logger = new LogClient({
      apiRoot: 'https://server.test/api',
    });
    await logger.startRun();
    clearRequests();
    let p = logger.addLog({
      type: 'mock-log',
      val: 1,
      date: new Date('2021-06-03T02:00:00.000Z'),
    });
    vi.runAllTimers();
    await p;
    expect(await waitForRequestJsonBodies()).toEqual([
      {
        url: 'https://server.test/api/experiments/experiment-id/runs/run-id/logs',
        method: 'POST',
        body: {
          logs: [
            {
              type: 'mock-log',
              date: '2021-06-03T02:00:00.000Z',
              values: { val: 1 },
            },
          ],
        },
      },
    ]);
  });

  it('should send batch multiple logs', async () => {
    const logger = new LogClient({
      apiRoot: 'https://server.test/api',
    });
    await logger.startRun();
    clearRequests();
    let p = Promise.all([
      logger.addLog({
        type: 'mock-log',
        val: 1,
        date: new Date('2021-06-03T02:00:00.000Z'),
      }),
      logger.addLog({
        type: 'mock-log',
        val: 2,
        date: new Date('2021-06-03T02:00:00.000Z'),
      }),
      logger.addLog({
        type: 'mock-log',
        val: 3,
        date: new Date('2021-06-03T02:00:00.000Z'),
      }),
    ]);
    vi.runAllTimers();
    await p;
    expect(await waitForRequestJsonBodies()).toEqual([
      {
        url: 'https://server.test/api/experiments/experiment-id/runs/run-id/logs',
        method: 'POST',
        body: {
          logs: [
            {
              type: 'mock-log',
              date: '2021-06-03T02:00:00.000Z',
              values: { val: 1 },
            },
            {
              type: 'mock-log',
              date: '2021-06-03T02:00:00.000Z',
              values: { val: 2 },
            },
            {
              type: 'mock-log',
              date: '2021-06-03T02:00:00.000Z',
              values: { val: 3 },
            },
          ],
        },
      },
    ]);
  });

  it('should flush', async () => {
    const logger = new LogClient({
      apiRoot: 'https://server.test/api',
    });
    await logger.startRun();
    clearRequests();
    logger.addLog({
      type: 'mock-log',
      val: 1,
      date: new Date('2021-06-03T02:00:00.000Z'),
    });
    logger.addLog({
      type: 'mock-log',
      val: 2,
      date: new Date('2021-06-03T02:00:00.000Z'),
    });
    logger.addLog({
      type: 'mock-log',
      val: 3,
      date: new Date('2021-06-03T02:00:00.000Z'),
    });
    // No timer this time, flush should send the request immediately.f
    await logger.flush();
    expect(await waitForRequestJsonBodies()).toEqual([
      {
        url: 'https://server.test/api/experiments/experiment-id/runs/run-id/logs',
        method: 'POST',
        body: {
          logs: [
            {
              type: 'mock-log',
              date: '2021-06-03T02:00:00.000Z',
              values: { val: 1 },
            },
            {
              type: 'mock-log',
              date: '2021-06-03T02:00:00.000Z',
              values: { val: 2 },
            },
            {
              type: 'mock-log',
              date: '2021-06-03T02:00:00.000Z',
              values: { val: 3 },
            },
          ],
        },
      },
    ]);
  });

  it('should complete', async () => {
    const logger = new LogClient({
      apiRoot: 'https://server.test/api',
    });
    await logger.startRun();
    clearRequests();
    await logger.completeRun();
    expect(await waitForRequestJsonBodies()).toEqual([
      {
        method: 'PUT',
        url: 'https://server.test/api/experiments/experiment-id/runs/run-id',
        body: { status: 'completed' },
      },
    ]);
  });

  it('should cancel', async () => {
    const logger = new LogClient({
      apiRoot: 'https://server.test/api',
    });
    await logger.startRun();
    clearRequests();
    await logger.cancelRun();
    expect(await waitForRequestJsonBodies()).toEqual([
      {
        method: 'PUT',
        url: 'https://server.test/api/experiments/experiment-id/runs/run-id',
        body: { status: 'canceled' },
      },
    ]);
  });
});
