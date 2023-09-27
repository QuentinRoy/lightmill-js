import { LogClient } from '../src/log-client.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { afterAll, afterEach, beforeAll } from 'vitest';
import type { Response as ApiResponse, Path } from '@lightmill/log-api';
import { setupServer } from 'msw/node';
import { rest } from 'msw';

// This does not work well because it does not prevent string from containing
// a slash, so some incorrect paths are allowed,
// e.g. /experiments/experiment-id/runs/run-id/no-correct.
type TemplatizedPath<P> = P extends `${infer Start}/:${string}/${infer End}`
  ? `${Start}/${string}/${TemplatizedPath<End>}`
  : P extends `${infer Start}/:${string}`
  ? `${Start}/${string}`
  : P;
type ServerPath = `https://server.test/api${TemplatizedPath<Path>}`;

const server = setupServer(
  rest.delete(
    'https://server.test/api/sessions/current' satisfies ServerPath,
    (req, res, ctx) => {
      return res(
        ctx.status(200),
        ctx.json({ status: 'ok' } satisfies ApiResponse<
          'delete',
          '/sessions/current'
        >),
      );
    },
  ),
  rest.post(
    'https://server.test/api/experiments/experiment-id/runs/run-id/logs' satisfies ServerPath,
    (req, res, ctx) => {
      return res(
        ctx.status(200),
        ctx.json({ status: 'ok' } satisfies ApiResponse<
          'post',
          '/experiments/:experimentId/runs/:runId/logs'
        >),
      );
    },
  ),
  rest.post(
    'https://server.test/api/runs' satisfies ServerPath,
    async (req, res, ctx) => {
      return res(
        ctx.status(200),
        ctx.json({
          status: 'ok',
          runId: 'run-id',
          experimentId: 'experiment-id',
        } satisfies ApiResponse<'post', '/runs'>),
      );
    },
  ),
  rest.patch(
    'https://server.test/api/experiments/experiment-id/runs/run-id' satisfies ServerPath,
    (req, res, ctx) => {
      return res(
        ctx.status(200),
        ctx.json({ status: 'ok' } satisfies ApiResponse<
          'patch',
          '/experiments/:experimentId/runs/:runId'
        >),
      );
    },
  ),
  rest.get(
    'https://server.test/api/sessions/current' satisfies ServerPath,
    (req, res, ctx) => {
      return res(
        ctx.status(200),
        ctx.json({
          status: 'ok',
          role: 'participant',
          runs: [],
        } satisfies ApiResponse<'get', '/sessions/current'>),
      );
    },
  ),
);

function setSessionRuns(
  runs: Array<{
    runId: string;
    experimentId: string;
    status: 'completed' | 'canceled' | 'running';
    logs: Array<{
      type: string;
      count: number;
      lastNumber: number;
      pending: number;
    }>;
  }>,
) {
  server.use(
    rest.get(
      'https://server.test/api/sessions/current' satisfies ServerPath,
      (req, res, ctx) => {
        return res(
          ctx.status(200),
          ctx.json({
            status: 'ok',
            role: 'participant',
            runs,
          } satisfies ApiResponse<'get', '/sessions/current'>),
        );
      },
    ),
    ...runs.flatMap((run) => [
      rest.get(
        `https://server.test/api/experiments/${run.experimentId}/runs/${run.runId}` satisfies ServerPath,
        (req, res, ctx) => {
          return res(
            ctx.status(200),
            ctx.json({ status: 'ok', run } satisfies ApiResponse<
              'get',
              '/experiments/:experimentId/runs/:runId'
            >),
          );
        },
      ),
      rest.patch(
        `https://server.test/api/experiments/${run.experimentId}/runs/${run.runId}` satisfies ServerPath,
        (req, res, ctx) => {
          return res(
            ctx.status(200),
            ctx.json({ status: 'ok' } satisfies ApiResponse<
              'patch',
              '/experiments/:experimentId/runs/:runId'
            >),
          );
        },
      ),
    ]),
  );
}

let requests: Array<{ url: string; method: string }> = [];
let requestBodies: Array<Promise<string>> = [];

async function waitForRequestBodies() {
  let bodies = await Promise.all(requestBodies);
  return bodies
    .map((body) => (body === '' ? undefined : JSON.parse(body)))
    .map((body, i) => ({ body, ...requests[i] }));
}
const changeRequestMethods = ['PUT', 'PATCH', 'POST', 'DELETE'];
async function waitForChangeRequestBodies() {
  let requests = await waitForRequestBodies();
  return requests.filter((r) => changeRequestMethods.includes(r.method));
}

function clearRequests() {
  requests = [];
  requestBodies = [];
}

// Start server before all tests.
beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

// Close server after all tests.
afterAll(() => {
  server.close();
});

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

describe('RunLogger#startRun', () => {
  it('should send a start request', async () => {
    const logger = new LogClient({
      apiRoot: 'https://server.test/api',
    });
    await logger.startRun();
    await expect(waitForChangeRequestBodies()).resolves.toEqual([
      {
        url: 'https://server.test/api/runs',
        method: 'POST',
        body: {},
      },
    ]);
  });

  it('should send a start request with parameters', async () => {
    const logger = new LogClient({
      apiRoot: 'https://server.test/api',
      runId: 'test-run',
      experimentId: 'test-experiment',
    });
    await logger.startRun();

    await expect(waitForChangeRequestBodies()).resolves.toEqual([
      {
        url: 'https://server.test/api/runs',
        method: 'POST',
        body: { runId: 'test-run', experimentId: 'test-experiment' },
      },
    ]);
  });

  it('should look for run to resume, but create a new run if none are found', async () => {
    const logger = new LogClient({
      apiRoot: 'https://server.test/api',
    });
    await logger.startRun({ resumeAfterType: 'test-type' });

    await expect(waitForChangeRequestBodies()).resolves.toEqual([
      {
        url: 'https://server.test/api/runs',
        method: 'POST',
        body: {},
      },
    ]);
  });

  it('should look for run to resume, but create a new run if no matching runs are found', async () => {
    setSessionRuns([
      {
        runId: 'other-run',
        experimentId: 'other-experiment',
        status: 'running',
        logs: [],
      },
    ]);
    const logger = new LogClient({
      apiRoot: 'https://server.test/api',
      experimentId: 'test-experiment',
    });
    await logger.startRun({ resumeAfterType: 'test-type' });
    await expect(waitForChangeRequestBodies()).resolves.toEqual([
      {
        url: 'https://server.test/api/runs',
        method: 'POST',
        body: { experimentId: 'test-experiment' },
      },
    ]);
  });

  it('should resume an existing matching fully defined run using a type to resume after', async () => {
    setSessionRuns([
      {
        runId: 'test-run',
        experimentId: 'test-experiment',
        status: 'running',
        logs: [
          { type: 'test-type', count: 4, lastNumber: 5, pending: 1 },
          { type: 'other-type', count: 3, lastNumber: 7, pending: 4 },
        ],
      },
    ]);
    const logger = new LogClient({
      apiRoot: 'https://server.test/api',
      runId: 'test-run',
      experimentId: 'test-experiment',
    });
    await logger.startRun({ resumeAfterType: 'test-type' });
    await expect(waitForChangeRequestBodies()).resolves.toEqual([
      {
        url: 'https://server.test/api/experiments/test-experiment/runs/test-run',
        method: 'PATCH',
        body: { resumeFrom: 6 },
      },
    ]);
  });

  it('should resume an existing matching fully defined run using multiple types to resume after', async () => {
    setSessionRuns([
      {
        runId: 'test-run',
        experimentId: 'test-experiment',
        status: 'running',
        logs: [
          { type: 'test-type1', count: 3, lastNumber: 5, pending: 2 },
          { type: 'test-type2', count: 1, lastNumber: 1, pending: 1 },
          { type: 'other-type', count: 3, lastNumber: 7, pending: 0 },
        ],
      },
    ]);
    const logger = new LogClient({
      apiRoot: 'https://server.test/api',
      runId: 'test-run',
      experimentId: 'test-experiment',
    });
    await logger.startRun({ resumeAfterType: ['test-type1', 'test-type2'] });
    await expect(waitForChangeRequestBodies()).resolves.toEqual([
      {
        url: 'https://server.test/api/experiments/test-experiment/runs/test-run',
        method: 'PATCH',
        body: { resumeFrom: 6 },
      },
    ]);
  });

  it('should resume an existing matching run defined by the experiment only using using a type to resume after', async () => {
    setSessionRuns([
      {
        runId: 'test-run',
        experimentId: 'test-experiment',
        status: 'running',
        logs: [
          { type: 'test-type', count: 3, lastNumber: 5, pending: 2 },
          { type: 'other-type1', count: 3, lastNumber: 7, pending: 0 },
          { type: 'other-type2', count: 1, lastNumber: 1, pending: 1 },
        ],
      },
    ]);
    const logger = new LogClient({
      apiRoot: 'https://server.test/api',
      experimentId: 'test-experiment',
    });
    await logger.startRun({ resumeAfterType: 'test-type' });
    await expect(waitForChangeRequestBodies()).resolves.toEqual([
      {
        url: 'https://server.test/api/experiments/test-experiment/runs/test-run',
        method: 'PATCH',
        body: { resumeFrom: 6 },
      },
    ]);
  });

  it('should resume an undefined existing matching run only using using a type to resume after', async () => {
    setSessionRuns([
      {
        runId: 'test-run',
        experimentId: 'test-experiment',
        status: 'running',
        logs: [
          { type: 'test-type', count: 3, lastNumber: 5, pending: 2 },
          { type: 'other-type1', count: 3, lastNumber: 7, pending: 0 },
          { type: 'other-type2', count: 1, lastNumber: 1, pending: 1 },
        ],
      },
    ]);
    const logger = new LogClient({
      apiRoot: 'https://server.test/api',
    });
    await logger.startRun({ resumeAfterType: 'test-type' });
    await expect(waitForChangeRequestBodies()).resolves.toEqual([
      {
        url: 'https://server.test/api/experiments/test-experiment/runs/test-run',
        method: 'PATCH',
        body: { resumeFrom: 6 },
      },
    ]);
  });

  it('should refuse to resume a run only if there is more than one matching', async () => {
    setSessionRuns([
      {
        runId: 'test-run-1',
        experimentId: 'test-experiment-1',
        status: 'running',
        logs: [{ type: 'test-type', count: 5, lastNumber: 5, pending: 2 }],
      },
      {
        runId: 'test-run-2',
        experimentId: 'test-experiment-2',
        status: 'running',
        logs: [{ type: 'test-type', count: 4, lastNumber: 4, pending: 2 }],
      },
    ]);
    const logger = new LogClient({
      apiRoot: 'https://server.test/api',
    });
    await expect(
      logger.startRun({ resumeAfterType: 'test-type' }),
    ).rejects.toThrow();
  });

  it('should not resume a matching completed run', async () => {
    setSessionRuns([
      {
        runId: 'test-run',
        experimentId: 'test-experiment',
        status: 'completed',
        logs: [{ type: 'test-type', count: 5, lastNumber: 5, pending: 2 }],
      },
    ]);
    const logger = new LogClient({
      runId: 'test-run',
      experimentId: 'test-experiment',
      apiRoot: 'https://server.test/api',
    });
    await logger.startRun({ resumeAfterType: 'test-type' });
    // This should be refused by the server since the run appears to already
    // exist.
    await expect(waitForChangeRequestBodies()).resolves.toEqual([
      {
        url: 'https://server.test/api/runs',
        method: 'POST',
        body: { runId: 'test-run', experimentId: 'test-experiment' },
      },
    ]);
  });

  it('should refuse a matching run if it is the only still running or cancelled', async () => {
    setSessionRuns([
      {
        runId: 'test-run-1',
        experimentId: 'test-experiment-1',
        status: 'running',
        logs: [{ type: 'test-type', count: 5, lastNumber: 5, pending: 2 }],
      },
      {
        runId: 'test-run-2',
        experimentId: 'test-experiment-2',
        status: 'completed',
        logs: [{ type: 'test-type', count: 4, lastNumber: 4, pending: 2 }],
      },
    ]);
    const logger = new LogClient({
      apiRoot: 'https://server.test/api',
    });
    await logger.startRun({ resumeAfterType: 'test-type' });
    await expect(waitForChangeRequestBodies()).resolves.toEqual([
      {
        url: 'https://server.test/api/experiments/test-experiment-1/runs/test-run-1',
        method: 'PATCH',
        body: { resumeFrom: 6 },
      },
    ]);
  });

  it('should resume a matching cancelled run', async () => {
    setSessionRuns([
      {
        runId: 'test-run-1',
        experimentId: 'test-experiment-1',
        status: 'canceled',
        logs: [{ type: 'test-type', count: 5, lastNumber: 5, pending: 2 }],
      },
    ]);
    const logger = new LogClient({
      apiRoot: 'https://server.test/api',
    });
    await logger.startRun({ resumeAfterType: 'test-type' });
    await expect(waitForChangeRequestBodies()).resolves.toEqual([
      {
        url: 'https://server.test/api/experiments/test-experiment-1/runs/test-run-1',
        method: 'PATCH',
        body: { resumeFrom: 6 },
      },
    ]);
  });
});

describe('RunLogger#addLog', () => {
  let logger: LogClient;

  beforeEach(async () => {
    logger = new LogClient({ apiRoot: 'https://server.test/api' });
    await logger.startRun();
    clearRequests();
  });

  it('should send one log', async () => {
    let p = logger.addLog({
      type: 'mock-log',
      val: 1,
      date: new Date('2021-06-03T02:00:00.000Z'),
    });
    vi.runAllTimers();
    await p;
    await expect(waitForChangeRequestBodies()).resolves.toEqual([
      {
        url: 'https://server.test/api/experiments/experiment-id/runs/run-id/logs',
        method: 'POST',
        body: {
          logs: [
            {
              type: 'mock-log',
              values: { val: 1, date: '2021-06-03T02:00:00.000Z' },
              number: 1,
            },
          ],
        },
      },
    ]);
  });

  it('should batch send multiple logs', async () => {
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
    await expect(waitForChangeRequestBodies()).resolves.toEqual([
      {
        url: 'https://server.test/api/experiments/experiment-id/runs/run-id/logs',
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
              values: { val: 2, date: '2021-06-03T02:00:00.000Z' },
            },
            {
              type: 'mock-log',
              number: 3,
              values: { val: 3, date: '2021-06-03T02:00:00.000Z' },
            },
          ],
        },
      },
    ]);
  });

  it('should add a default date to logs sent alone', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime('2019-06-03T02:00:00.000Z');
    let p = logger.addLog({ type: 'mock-log', val: 1 });
    vi.runAllTimers();
    await p;
    await expect(waitForChangeRequestBodies()).resolves.toEqual([
      {
        url: 'https://server.test/api/experiments/experiment-id/runs/run-id/logs',
        method: 'POST',
        body: {
          logs: [
            {
              type: 'mock-log',
              values: { val: 1, date: '2019-06-03T02:00:00.000Z' },
              number: 1,
            },
          ],
        },
      },
    ]);
  });

  it('should add a default date to logs sent in a batch', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime('2019-06-03T02:00:00.000Z');
    let p = logger.addLog({ type: 'mock-log', val: 1 });
    vi.setSystemTime('2019-06-03T02:00:00.100Z');
    p = logger.addLog({ type: 'mock-log', val: 2 });
    vi.runAllTimers();
    await p;
    await expect(waitForChangeRequestBodies()).resolves.toEqual([
      {
        url: 'https://server.test/api/experiments/experiment-id/runs/run-id/logs',
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
        },
      },
    ]);
  });

  it('should send logs with no provided values', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime('2019-06-03T02:00:00.000Z');
    let p = logger.addLog({ type: 'mock-log' });
    vi.runAllTimers();
    await p;
    await expect(waitForChangeRequestBodies()).resolves.toEqual([
      {
        url: 'https://server.test/api/experiments/experiment-id/runs/run-id/logs',
        method: 'POST',
        body: {
          logs: [
            {
              type: 'mock-log',
              values: { date: '2019-06-03T02:00:00.000Z' },
              number: 1,
            },
          ],
        },
      },
    ]);
  });
});

describe('RunLogger#flush', () => {
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
      date: new Date('2021-06-03T03:00:00.000Z'),
    });
    logger.addLog({
      type: 'mock-log',
      val: 3,
      date: new Date('2021-06-03T04:00:00.000Z'),
    });
    // No timer this time, flush should send the request immediately.
    await logger.flush();
    await expect(waitForChangeRequestBodies()).resolves.toEqual([
      {
        url: 'https://server.test/api/experiments/experiment-id/runs/run-id/logs',
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
        },
      },
    ]);
  });
});

describe('RunLogger#completeRun', () => {
  it('should complete', async () => {
    const logger = new LogClient({
      apiRoot: 'https://server.test/api',
    });
    await logger.startRun();
    clearRequests();
    await logger.completeRun();
    await expect(waitForChangeRequestBodies()).resolves.toEqual([
      {
        method: 'PATCH',
        url: 'https://server.test/api/experiments/experiment-id/runs/run-id',
        body: { status: 'completed' },
      },
    ]);
  });
});

describe('RunLogger#cancelRun', () => {
  it('should cancel', async () => {
    const logger = new LogClient({
      apiRoot: 'https://server.test/api',
    });
    await logger.startRun();
    clearRequests();
    await logger.cancelRun();
    await expect(waitForChangeRequestBodies()).resolves.toEqual([
      {
        method: 'PATCH',
        url: 'https://server.test/api/experiments/experiment-id/runs/run-id',
        body: { status: 'canceled' },
      },
    ]);
  });
});

describe('RunLogger#logout', () => {
  it('should close the session', async () => {
    const logger = new LogClient({
      apiRoot: 'https://server.test/api',
    });
    await logger.startRun();
    clearRequests();
    await logger.logout();
    await expect(waitForChangeRequestBodies()).resolves.toEqual([
      {
        method: 'DELETE',
        url: 'https://server.test/api/sessions/current',
      },
    ]);
  });
});
