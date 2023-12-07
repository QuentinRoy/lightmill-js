import { LogClient } from '../src/log-client.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { afterAll, afterEach, beforeAll } from 'vitest';
import type {
  Response as ApiResponse,
  Path,
  Body as ApiBody,
} from '@lightmill/log-api';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';

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
  http.delete(
    'https://server.test/api/sessions/current' satisfies ServerPath,
    () => {
      return HttpResponse.json({ status: 'ok' } satisfies ApiResponse<
        'delete',
        '/sessions/current'
      >);
    },
  ),
  http.post(
    'https://server.test/api/runs' satisfies ServerPath,
    async ({ request }) => {
      let body = (await request.json()) as ApiBody<'post', '/runs'>;
      return HttpResponse.json({
        status: 'ok',
        runId: body?.runId ?? 'default-run-id',
        experimentId: body?.experimentId ?? 'default-experiment-id',
      } satisfies ApiResponse<'post', '/runs'>);
    },
  ),
  http.get(
    'https://server.test/api/sessions/current' satisfies ServerPath,
    () => {
      return HttpResponse.json({
        status: 'ok',
        role: 'participant',
        runs: [],
      } satisfies ApiResponse<'get', '/sessions/current'>);
    },
  ),
);

function setServerRuns(
  runs: Array<{
    runId: string;
    experimentId: string;
    status?: 'completed' | 'canceled' | 'running';
    logs?: Array<{
      type: string;
      count: number;
      lastNumber: number;
      pending: number;
    }>;
  }>,
) {
  server.use(
    http.get(
      'https://server.test/api/sessions/current' satisfies ServerPath,
      () => {
        return HttpResponse.json({
          status: 'ok',
          role: 'participant',
          runs,
        } satisfies ApiResponse<'get', '/sessions/current'>);
      },
    ),
    ...runs.flatMap((run) => [
      http.get(
        `https://server.test/api/experiments/${run.experimentId}/runs/${run.runId}` satisfies ServerPath,
        () => {
          return HttpResponse.json({
            status: 'ok',
            run: { status: 'running', logs: [], ...run },
          } satisfies ApiResponse<
            'get',
            '/experiments/:experimentId/runs/:runId'
          >);
        },
      ),
      http.patch(
        `https://server.test/api/experiments/${run.experimentId}/runs/${run.runId}` satisfies ServerPath,
        () => {
          return HttpResponse.json({ status: 'ok' } satisfies ApiResponse<
            'patch',
            '/experiments/:experimentId/runs/:runId'
          >);
        },
      ),
    ]),
    ...runs.flatMap((run) => [
      http.post(
        `https://server.test/api/experiments/${run.experimentId}/runs/${run.runId}/logs` satisfies ServerPath,
        () => {
          return HttpResponse.json({ status: 'ok' } satisfies ApiResponse<
            'post',
            '/experiments/:experimentId/runs/:runId/logs'
          >);
        },
      ),
      http.patch(
        `https://server.test/api/experiments/${run.experimentId}/runs/${run.runId}` satisfies ServerPath,
        () => {
          return HttpResponse.json({ status: 'ok' } satisfies ApiResponse<
            'patch',
            '/experiments/:experimentId/runs/:runId'
          >);
        },
      ),
    ]),
  );
}

let requests: Array<Request> = [];

async function waitForRequests() {
  return Promise.all(
    requests.map(async (r) => {
      let body = r.body == null ? null : await r.json();
      return { method: r.method, url: r.url, body };
    }),
  );
}

// In most cases, these are the one we care about because these are the one
// that actually change the state of the server.
const HTTP_CHANGE_METHODS = ['PUT', 'PATCH', 'POST', 'DELETE'];
async function waitForChangeRequests() {
  let requests = await waitForRequests();
  return requests.filter((r) => HTTP_CHANGE_METHODS.includes(r.method));
}

function clearRequests() {
  requests = [];
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
  server.events.on('request:start', ({ request }) => {
    // We need to clone the request because it is a stream and may be
    // consumed by the server.
    requests.push(request.clone());
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
    await expect(waitForChangeRequests()).resolves.toEqual([
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

    await expect(waitForChangeRequests()).resolves.toEqual([
      {
        url: 'https://server.test/api/runs',
        method: 'POST',
        body: { runId: 'test-run', experimentId: 'test-experiment' },
      },
    ]);
  });
});
describe('RunLogger#resumeRun', () => {
  it('should resume an existing run using a type to resume after', async () => {
    setServerRuns([
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
    await expect(
      logger.resumeRun({ resumeAfterLast: 'test-type' }),
    ).resolves.toEqual({ type: 'test-type', number: 4 });
    await expect(waitForChangeRequests()).resolves.toEqual([
      {
        url: 'https://server.test/api/experiments/test-experiment/runs/test-run',
        method: 'PATCH',
        body: { resumeFrom: 6 },
      },
    ]);
  });

  it('should resume an existing run using multiple types to resume after', async () => {
    setServerRuns([
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
    await expect(
      logger.resumeRun({ resumeAfterLast: ['test-type1', 'test-type2'] }),
    ).resolves.toEqual({ type: 'test-type1', number: 3 });
    await expect(waitForChangeRequests()).resolves.toEqual([
      {
        url: 'https://server.test/api/experiments/test-experiment/runs/test-run',
        method: 'PATCH',
        body: { resumeFrom: 6 },
      },
    ]);
  });

  it('should resume an existing run even if no matching logs are found', async () => {
    setServerRuns([
      {
        runId: 'test-run',
        experimentId: 'test-experiment',
        status: 'running',
        logs: [
          { type: 'test-type1', count: 3, lastNumber: 5, pending: 2 },
          { type: 'test-type2', count: 1, lastNumber: 1, pending: 1 },
        ],
      },
    ]);
    const logger = new LogClient({
      apiRoot: 'https://server.test/api',
      runId: 'test-run',
      experimentId: 'test-experiment',
    });
    await expect(
      logger.resumeRun({ resumeAfterLast: ['other-type'] }),
    ).resolves.toBeNull();
    await expect(waitForChangeRequests()).resolves.toEqual([
      {
        url: 'https://server.test/api/experiments/test-experiment/runs/test-run',
        method: 'PATCH',
        body: { resumeFrom: 1 },
      },
    ]);
  });

  it('should be able to use the runId and experimentId from its parameter', async () => {
    setServerRuns([
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
    const logger = new LogClient({ apiRoot: 'https://server.test/api' });
    await expect(
      logger.resumeRun({
        resumeAfterLast: ['test-type1', 'test-type2'],
        experimentId: 'test-experiment',
        runId: 'test-run',
      }),
    ).resolves.toEqual({ type: 'test-type1', number: 3 });
    await expect(waitForChangeRequests()).resolves.toEqual([
      {
        url: 'https://server.test/api/experiments/test-experiment/runs/test-run',
        method: 'PATCH',
        body: { resumeFrom: 6 },
      },
    ]);
  });

  it("should use resumeRun's parameter if the constructor did not provide a run or an experiment", async () => {
    setServerRuns([
      {
        runId: 'test-run',
        experimentId: 'test-experiment',
        status: 'running',
        logs: [
          { type: 'test-type1', count: 3, lastNumber: 5, pending: 2 },
          { type: 'test-type2', count: 1, lastNumber: 1, pending: 1 },
          { type: 'other-type', count: 4, lastNumber: 8, pending: 0 },
        ],
      },
    ]);
    const logger = new LogClient({
      apiRoot: 'https://server.test/api',
    });
    await expect(
      logger.resumeRun({
        resumeAfterLast: ['test-type1', 'test-type2'],
        experimentId: 'test-experiment',
        runId: 'test-run',
      }),
    ).resolves.toEqual({ type: 'test-type1', number: 3 });
    await expect(waitForChangeRequests()).resolves.toEqual([
      {
        url: 'https://server.test/api/experiments/test-experiment/runs/test-run',
        method: 'PATCH',
        body: { resumeFrom: 6 },
      },
    ]);
  });

  it('should refuse to resume a run with an experimentId different than the one provided in the constructor', async () => {
    const logger = new LogClient({
      apiRoot: 'https://server.test/api',
      experimentId: 'original-experiment',
    });
    await expect(
      logger.resumeRun({
        resumeAfterLast: ['test-type1', 'test-type2'],
        experimentId: 'test-experiment',
        runId: 'test-run',
      }),
    ).rejects.toThrowError(Error);
  });

  it('should refuse to resume a run with a runId different than the one provided in the constructor', async () => {
    const logger = new LogClient({
      apiRoot: 'https://server.test/api',
      runId: 'original-run',
    });
    await expect(
      logger.resumeRun({
        resumeAfterLast: 'test-type',
        experimentId: 'test-experiment',
        runId: 'test-run',
      }),
    ).rejects.toThrowError(Error);
  });

  it("should refuse to resume a run if the experimentId isn't defined", async () => {
    const logger = new LogClient({
      apiRoot: 'https://server.test/api',
      runId: 'original-run',
    });
    await expect(
      logger.resumeRun({ resumeAfterLast: 'test-type' }),
    ).rejects.toThrowError(Error);
  });

  it("should refuse to resume a run if the runId isn't defined", async () => {
    const logger = new LogClient({
      apiRoot: 'https://server.test/api',
      experimentId: 'original-run',
    });
    await expect(
      logger.resumeRun({ resumeAfterLast: 'test-type' }),
    ).rejects.toThrowError(Error);
  });
});

describe('RunLogger#addLog (after start)', () => {
  let logger: LogClient;

  beforeEach(async () => {
    setServerRuns([{ runId: 'run-id', experimentId: 'experiment-id' }]);
    logger = new LogClient({ apiRoot: 'https://server.test/api' });
    await logger.startRun({ experimentId: 'experiment-id', runId: 'run-id' });
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
    await expect(waitForChangeRequests()).resolves.toEqual([
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
    await expect(waitForChangeRequests()).resolves.toEqual([
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
              values: { val: 2, date: '2021-06-03T02:00:10.000Z' },
            },
            {
              type: 'mock-log',
              number: 3,
              values: { val: 3, date: '2021-06-03T02:00:20.000Z' },
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
    await expect(waitForChangeRequests()).resolves.toEqual([
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
    await expect(waitForChangeRequests()).resolves.toEqual([
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
    await expect(waitForChangeRequests()).resolves.toEqual([
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

describe('RunLogger#addLog (after resume)', () => {
  it('should properly start numbering after a run has been resumed', async () => {
    setServerRuns([
      {
        experimentId: 'test-experiment',
        runId: 'test-run',
        status: 'running',
        logs: [
          { type: 'test-type', count: 3, lastNumber: 4, pending: 2 },
          { type: 'other-type', count: 3, lastNumber: 6, pending: 0 },
        ],
      },
    ]);
    const logger = new LogClient({ apiRoot: 'https://server.test/api' });
    await logger.resumeRun({
      resumeAfterLast: 'test-type',
      experimentId: 'test-experiment',
      runId: 'test-run',
    });
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
    await expect(waitForChangeRequests()).resolves.toEqual([
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
        },
      },
    ]);
  });
});

describe('RunLogger#flush', () => {
  it('should flush', async () => {
    setServerRuns([{ runId: 'run-id', experimentId: 'experiment-id' }]);
    const logger = new LogClient({ apiRoot: 'https://server.test/api' });
    await logger.startRun({ runId: 'run-id', experimentId: 'experiment-id' });
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
    await expect(waitForChangeRequests()).resolves.toEqual([
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
    setServerRuns([{ runId: 'run-id', experimentId: 'experiment-id' }]);
    const logger = new LogClient({ apiRoot: 'https://server.test/api' });
    await logger.startRun({ runId: 'run-id', experimentId: 'experiment-id' });
    clearRequests();
    await logger.completeRun();
    await expect(waitForChangeRequests()).resolves.toEqual([
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
    setServerRuns([{ runId: 'run-id', experimentId: 'experiment-id' }]);
    const logger = new LogClient({ apiRoot: 'https://server.test/api' });
    await logger.startRun({ runId: 'run-id', experimentId: 'experiment-id' });
    clearRequests();
    await logger.cancelRun();
    await expect(waitForChangeRequests()).resolves.toEqual([
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
    await expect(waitForChangeRequests()).resolves.toEqual([
      {
        method: 'DELETE',
        url: 'https://server.test/api/sessions/current',
        body: null,
      },
    ]);
  });
});
