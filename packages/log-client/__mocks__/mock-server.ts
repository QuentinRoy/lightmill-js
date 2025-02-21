import {
  HttpHandler,
  HttpResponse,
  HttpResponseResolver,
  RequestHandler,
  http,
} from 'msw';
import { setupServer, SetupServerApi } from 'msw/node';
import { test } from 'vitest';

export class MockServer {
  #baseUrl = 'https://server.test/api';
  #runs: Array<Run> = [];
  #server: SetupServerApi;
  #requests: Array<Request> = [];

  getBaseUrl(): string {
    return this.#baseUrl;
  }

  constructor() {
    this.#server = setupServer(...this.#getHandlers());
    this.#server.events.on('request:start', ({ request }) => {
      // We need to clone the request because it is a stream and may be
      // consumed by the server.
      this.#requests.push(request.clone());
    });
  }

  #getHandlers(): RequestHandler[] {
    const { get, delete: del, put, post, patch } = createMethods(this.#baseUrl);
    return [
      get('/sessions/current', () =>
        HttpResponse.json({
          role: 'participant',
          runs: this.#runs.map((run) => ({
            runStatus: 'running' as const,
            ...run,
          })),
        }),
      ),
      put('/sessions/current', () =>
        HttpResponse.json({
          role: 'participant',
          runs: this.#runs.map((run) => ({ runStatus: 'running', ...run })),
        }),
      ),
      del('/sessions/current', () => HttpResponse.json({ status: 'ok' })),
      post('/runs', async ({ request }) => {
        let body = await request.json();
        if (typeof body !== 'object') {
          throw new Error('Unexpected body type');
        }
        return HttpResponse.json({
          runStatus: 'running',
          runName: body?.runName ?? 'default-run-id',
          experimentName: body?.experimentName ?? 'default-experiment-id',
        });
      }),
      get('/experiments/:experimentName/runs/:runName', ({ params }) => {
        const run = this.#getRun(params);
        if (run == null) {
          return HttpResponse.json(
            { message: 'Run not found' },
            { status: 404 },
          );
        }
        return HttpResponse.json({ runStatus: 'running', logs: [], ...run });
      }),
      patch('/experiments/:experimentName/runs/:runName', ({ params }) => {
        const run = this.#getRun(params);
        if (run == null) {
          return HttpResponse.json(
            { message: 'Run not found' },
            { status: 404 },
          );
        }
        return HttpResponse.json();
      }),
      post('/experiments/:experimentName/runs/:runName/logs', ({ params }) => {
        const run = this.#getRun(params);
        if (run == null) {
          return HttpResponse.json(
            { message: 'Run not found' },
            { status: 404 },
          );
        }
        return HttpResponse.json();
      }),
    ];
  }

  #getRun(params: {
    experimentName?: string | string[];
    runName?: string | string[];
  }) {
    let runNames = Array.isArray(params.runName)
      ? params.runName
      : params.runName == null
        ? []
        : [params.runName];
    let experimentNames = Array.isArray(params.experimentName)
      ? params.experimentName
      : params.experimentName == null
        ? []
        : [params.experimentName];
    return this.#runs.find(
      (r) =>
        runNames.includes(r.runName) &&
        experimentNames.includes(r.experimentName),
    );
  }

  async waitForRequests() {
    return Promise.all(
      this.#requests.map(async (r) => {
        let body = r.body == null ? null : await r.json();
        return { method: r.method, url: r.url, body };
      }),
    );
  }

  // In most cases, these are the ones we care about because these are the ones
  // that actually change the state of the server.
  static #HTTP_CHANGE_METHODS = ['PUT', 'PATCH', 'POST', 'DELETE'];
  async waitForChangeRequests() {
    let requests = await this.waitForRequests();
    return requests.filter((r) =>
      MockServer.#HTTP_CHANGE_METHODS.includes(r.method),
    );
  }

  setRuns(runs: Run[]) {
    this.#runs = runs;
  }

  reset() {
    this.#requests = [];
    this.#runs = [];
  }

  start() {
    this.#server.listen({ onUnhandledRequest: 'error' });
  }

  stop() {
    this.#server.close();
  }
}

function createMethods(baseUrl: string) {
  let result: Record<
    string,
    (p: string, handler: HttpResponseResolver) => HttpHandler
  > = {};
  for (let method of ['get', 'put', 'post', 'patch', 'delete'] as const) {
    result[method] = (path, handler) =>
      http[method](`${baseUrl}${path}`, handler);
  }

  return result;
}

type Run = {
  runName: string;
  experimentName: string;
  runStatus?: 'completed' | 'canceled' | 'running' | 'interrupted';
  logs?: Array<{
    type: string;
    count: number;
    lastNumber: number;
    pending: number;
  }>;
};

interface Fixture {
  server: MockServer;
}

export const serverTest = test.extend<Fixture>({
  // eslint-disable-next-line no-empty-pattern
  server: async ({}, use) => {
    let server = new MockServer();
    server.start();
    await use(server);
    server.stop();
  },
});
