import {
  http,
  HttpHandler,
  HttpResponse,
  HttpResponseResolver,
  RequestHandler,
} from 'msw';
import { setupServer, SetupServerApi } from 'msw/node';
import { RequiredKeysOf } from 'type-fest';
import { test } from 'vitest';
import { paths } from '../generated/api.js';

type ApiReponseCode<
  Path extends keyof paths,
  Method extends Exclude<RequiredKeysOf<paths[Path]>, 'parameters'>,
> = paths extends {
  [P in Path]: { [M in Method]: { responses: infer Responses } };
}
  ? keyof Responses
  : never;

type ApiResponse<
  Path extends keyof paths,
  Method extends Exclude<RequiredKeysOf<paths[Path]>, 'parameters'>,
  Status extends ApiReponseCode<Path, Method> = ApiReponseCode<Path, Method>,
> = paths extends {
  [P in Path]: {
    [M in Method]: {
      responses: {
        [S in Status]: { content: { 'application/json': infer R } };
      };
    };
  };
}
  ? R
  : never;

type ApiRequestBody<
  Path extends keyof paths,
  Method extends Exclude<RequiredKeysOf<paths[Path]>, 'parameters'>,
> = paths extends {
  [P in Path]: {
    [M in Method]: {
      requestBody: { content: { 'application/json': infer R } };
    };
  };
}
  ? R
  : never;

export class MockServer {
  #baseUrl = 'https://server.test/api';
  #runs = new Map<string, Run>();
  #experiments = new Map<string, Experiment>();
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
    const { get, delete: del, post, patch } = createMethods(this.#baseUrl);
    return [
      get('/experiments/:experimentId', ({ params }) => {
        const experiment = this.#experiments.get(params.experimentId as string);
        if (experiment == null) {
          return HttpResponse.json(
            { errors: [] } satisfies ApiResponse<
              '/experiments/{id}',
              'get',
              404
            >,
            { status: 404 },
          );
        }
        return HttpResponse.json(
          {
            data: {
              id: experiment.id,
              type: 'experiments',
              attributes: { name: experiment.name },
            },
          } satisfies ApiResponse<'/experiments/{id}', 'get', 200>,
          { status: 200 },
        );
      }),

      get('/experiments', ({ request }) => {
        const queryParams = parseUrlQuery(request.url);
        return HttpResponse.json(
          {
            data: Array.from(this.#experiments.values())
              .filter((e) => {
                let nameFilter = queryParams['filter[name]'];
                if (nameFilter == null) {
                  return true;
                }
                return nameFilter.includes(e.name);
              })
              .map((experiment) => ({
                id: experiment.id,
                type: 'experiments',
                attributes: { name: experiment.name },
              })),
          } satisfies ApiResponse<'/experiments', 'get', 200>,
          { status: 200 },
        );
      }),

      get('/sessions/current', () =>
        HttpResponse.json({
          data: {
            type: 'sessions',
            id: 'current',
            attributes: { role: 'participant' },
            relationships: {
              runs: {
                data: Array.from(this.#runs.values(), (r) => ({
                  type: 'runs',
                  id: r.runId,
                })),
              },
            },
          },
        } satisfies ApiResponse<'/sessions/{id}', 'get', 200>),
      ),

      del('/sessions/current', () =>
        HttpResponse.json({ data: null } satisfies ApiResponse<
          '/sessions/{id}',
          'delete',
          200
        >),
      ),

      get('/runs', async ({ request }) => {
        const queryParams = parseUrlQuery(request.url);
        return HttpResponse.json(
          {
            data: Array.from(this.#runs.values())
              .filter((r) => {
                let statusFilter = queryParams['filter[status]'];
                if (statusFilter == null) {
                  return true;
                }
                return statusFilter.includes(r.runStatus);
              })
              .map((r) => ({
                type: 'runs',
                id: r.runId,
                attributes: {
                  status: r.runStatus,
                  name: r.runName,
                  lastLogNumber: Math.max(
                    0,
                    ...r.lastLogs.map((log) => log.number),
                  ),
                },
                relationships: {
                  experiment: {
                    data: { type: 'experiments', id: r.experimentId },
                  },
                  lastLogs: {
                    data: r.lastLogs.map((log) => ({
                      type: 'logs',
                      id: log.id,
                    })),
                  },
                },
              })),
            included: [
              ...Array.from(this.#runs.values()).flatMap((r) =>
                r.lastLogs.map((log) => ({
                  type: 'logs' as const,
                  id: log.id,
                  attributes: {
                    logType: log.type,
                    number: log.number,
                    values: log.values,
                  },
                  relationships: {
                    run: { data: { type: 'runs' as const, id: r.runId } },
                  },
                })),
              ),
              ...Array.from(this.#experiments.values()).map((e) => {
                return {
                  type: 'experiments' as const,
                  id: e.id,
                  attributes: { name: e.name },
                };
              }),
            ],
          } satisfies ApiResponse<'/runs', 'get', 200>,
          { status: 200 },
        );
      }),

      post('/runs', async () => {
        return HttpResponse.json(
          {
            data: { type: 'runs', id: 'default-run-id' },
          } satisfies ApiResponse<'/runs', 'post', 201>,
          { status: 201 },
        );
      }),

      get('/runs/:runId', ({ params, request }) => {
        const run = this.#runs.get(params.runId as string);
        if (run == null) {
          return HttpResponse.json(
            { errors: [] } satisfies ApiResponse<'/runs/{id}', 'get', 404>,
            { status: 404 },
          );
        }
        let included: ApiResponse<'/runs/{id}', 'get', 200>['included'];
        let urlParams = parseUrlQuery(request.url);
        if (urlParams.include?.includes('experiment')) {
          included = included ?? [];
          included.push({
            type: 'experiments',
            id: run.experimentId,
            attributes: {
              name:
                this.#experiments.get(run.experimentId)?.name ??
                'Unknown Experiment',
            },
          });
        }
        if (urlParams.include?.includes('lastLogs')) {
          included = included ?? [];
          included.push(
            ...run.lastLogs.map((log) => ({
              type: 'logs' as const,
              id: log.id,
              attributes: {
                logType: log.type,
                number: log.number,
                values: log.values,
              },
              relationships: {
                run: { data: { type: 'runs' as const, id: run.runId } },
              },
            })),
          );
        }
        return HttpResponse.json({
          data: {
            type: 'runs',
            id: run.runId,
            attributes: {
              name: run.runName,
              status: run.runStatus,
              lastLogNumber: Math.max(...run.lastLogs.map((l) => l.number)),
            },
            relationships: {
              experiment: {
                data: { type: 'experiments', id: run.experimentId },
              },
              lastLogs: {
                data: run.lastLogs.map((log) => ({ type: 'logs', id: log.id })),
              },
            },
          },
          included,
        } satisfies ApiResponse<'/runs/{id}', 'get', 200>);
      }),

      patch('/runs/:id', async ({ params, request }) => {
        const body = (await request.json()) as ApiRequestBody<
          '/runs/{id}',
          'patch'
        >;
        const run = this.#runs.get(params.id as string);
        if (run == null) {
          return HttpResponse.json(
            { errors: [] } satisfies ApiResponse<'/runs/{id}', 'patch', 404>,
            { status: 404 },
          );
        }
        run.runStatus = body.data.attributes?.status ?? run.runStatus;
        const lastLogNumber = body.data.attributes?.lastLogNumber;
        if (lastLogNumber != null) {
          run.lastLogs = run.lastLogs.filter((l) => l.number <= lastLogNumber);
        }

        return HttpResponse.json({
          data: {
            id: run.runId,
            type: 'runs' as const,
            attributes: {
              status: run.runStatus,
              lastLogNumber: Math.max(0, ...run.lastLogs.map((l) => l.number)),
            },
            relationships: {
              experiment: {
                data: { id: run.experimentId, type: 'experiments' },
              },
              lastLogs: {
                data: run.lastLogs.map((l) => ({ id: l.id, type: 'logs' })),
              },
            },
          },
        } satisfies ApiResponse<'/runs/{id}', 'patch', 200>);
      }),

      post('/logs', () => {
        return HttpResponse.json({
          data: { id: 'log-id', type: 'logs' },
        } satisfies ApiResponse<'/logs', 'post', 201>);
      }),
    ];
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

  set(
    entries: Array<
      | (Omit<Run, 'lastLogs'> & {
          experimentName?: string;
          lastLogs?: Array<{
            type: string;
            number: number;
            id?: string;
            values?: Record<string, unknown> & { date?: Date };
          }>;
        })
      | { experimentName?: string; experimentId: string }
    >,
  ) {
    this.#runs = new Map();
    this.#experiments = new Map();
    for (let i = 0; i < entries.length; i++) {
      let entry = entries[i];
      let experimentName: string =
        entry.experimentName != null
          ? entry.experimentName
          : `${entry.experimentId}-name`;
      if ('runId' in entry) {
        let { lastLogs, ...run } = entry;
        let runName = run.runName ?? `${run.runId}-name`;
        this.#runs.set(run.runId, {
          ...run,
          runName,
          lastLogs:
            lastLogs?.map((l) => {
              let id = l.id ?? `log-${run.runId}-${l.number}`;
              let date = l.values?.date ?? new Date();
              let values = { ...l.values, date: date.toISOString() };
              return { ...l, id, values };
            }) ?? [],
        });
        if (!this.#experiments.has(entry.experimentId)) {
          this.#experiments.set(entry.experimentId, {
            id: entry.experimentId,
            name: experimentName,
          });
        }
        continue;
      }
      this.#experiments.set(entry.experimentId, {
        id: entry.experimentId,
        name: experimentName,
      });
    }
  }

  reset() {
    this.#requests = [];
    this.#runs = new Map();
    this.#experiments = new Map();
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
  runId: string;
  runName?: string;
  experimentId: string;
  runStatus: 'idle' | 'completed' | 'canceled' | 'running' | 'interrupted';
  lastLogs: Array<{
    id: string;
    type: string;
    number: number;
    values: Record<string, unknown> & { date: string };
  }>;
};

type Experiment = { id: string; name: string };

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

function parseUrlQuery(url: string) {
  let query = url.split('?')[1];
  if (query == null) return {};
  return query.split('&').reduce<Record<string, string[]>>((acc, pair) => {
    let [key, value] = pair.split('=');
    let values = acc[key] || [];
    values.push(value);
    acc[key] = values;
    return acc;
  }, {});
}
