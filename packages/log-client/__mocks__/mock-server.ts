/* eslint-disable @typescript-eslint/no-explicit-any */
import { type paths } from '@lightmill/log-api';
import {
  http,
  HttpResponse,
  RequestHandler,
  type JsonBodyType,
  type StrictRequest,
} from 'msw';
import { setupServer, SetupServerApi } from 'msw/node';
import type { IsNever, RequiredKeysOf } from 'type-fest';
import { test, vi, type Mock } from 'vitest';
import { apiMediaType } from '../src/utils.js';

export type ApiMediaType = typeof apiMediaType;
const _httpMethods = [
  'get',
  'put',
  'post',
  'delete',
  'options',
  'head',
  'patch',
] as const;
type HttpMethod = (typeof _httpMethods)[number];

type PathMethod<Path extends keyof paths> = Extract<
  RequiredKeysOf<paths[Path]>,
  HttpMethod
>;

type ApiRequestBody<
  Path extends keyof paths,
  Method extends PathMethod<Path>,
> = paths extends {
  [P in Path]: {
    [M in Method]: {
      requestBody: { content: { [K in ApiMediaType]: infer R } };
    };
  };
}
  ? R
  : never;

type ApiRequestPathParams<
  Path extends keyof paths,
  Method extends PathMethod<Path>,
> = paths extends {
  [P in Path]: { [M in Method]: { parameters: { path?: infer R } } };
}
  ? R extends object
    ? R
    : Record<PropertyKey, never>
  : never;

type BaseServerHandler<
  Params = Record<string, string | readonly string[] | undefined>,
  Body extends JsonBodyType = JsonBodyType,
  Response extends { body: JsonBodyType; status: number } = {
    body: JsonBodyType;
    status: number;
  },
> = ({
  params,
  body,
  request,
}: {
  params: Params;
  body: Body;
  request: StrictRequest<Body>;
}) => Promise<Response> | Response;

type ServerHandler<
  Path extends keyof paths,
  Method extends PathMethod<Path>,
> = paths extends {
  [P in Path]: { [M in Method]: { responses: infer Responses } };
}
  ? BaseServerHandler<
      ApiRequestPathParams<Path, Method>,
      IsNever<ApiRequestBody<Path, Method>> extends true
        ? undefined
        : ApiRequestBody<Path, Method>,
      {
        [Status in keyof Responses]: Responses[Status] extends {
          content: { [K in ApiMediaType]: infer Body extends JsonBodyType };
        }
          ? { body: Body; status: Status extends number ? Status : never }
          : never;
      }[keyof Responses]
    >
  : never;

type HandlerMap = {
  [Path in keyof paths]: {
    [Method in PathMethod<Path>]: ServerHandler<Path, Method>;
  };
};

type MockedMethodsDeep<T> =
  T extends Record<PropertyKey, unknown>
    ? { [K in keyof T]: MockedMethodsDeep<T[K]> }
    : T extends (...args: any) => any
      ? Mock<T>
      : T;

type MockedHandlerMap = MockedMethodsDeep<HandlerMap>;

export class MockServer {
  #baseUrl = 'https://server.test/api';
  #runs = new Map<string, Run>();
  #experiments = new Map<string, Experiment>();
  #server: SetupServerApi;
  #requests: Array<Request> = [];
  handlers: MockedHandlerMap = this.#createMockedHandlersMap();

  getBaseUrl(): string {
    return this.#baseUrl;
  }

  constructor() {
    const serverHandlers = this.#createMswHandlers();
    this.#server = setupServer(...serverHandlers);
    this.#server.events.on('request:start', ({ request }) => {
      // We need to clone the request because it is a stream and may be
      // consumed by the server.
      this.#requests.push(request.clone());
    });
  }

  #createMockedHandlersMap(): MockedHandlerMap {
    const handlers: HandlerMap = {
      '/experiments/{id}': {
        get: async ({ params }) => {
          const experiment = this.#experiments.get(params.id as string);
          if (experiment == null) {
            return {
              body: {
                errors: [{ status: 'Not Found', code: 'EXPERIMENT_NOT_FOUND' }],
              },
              status: 404,
            };
          }
          return {
            body: {
              data: {
                id: experiment.id,
                type: 'experiments',
                attributes: { name: experiment.name },
              },
            },
            status: 200,
          };
        },
      },

      '/experiments': {
        get: async ({ request }) => {
          const queryParams = parseUrlQuery(request.url);
          return {
            body: {
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
            },
            status: 200,
          };
        },
        post: async () => {
          throw new Error('Not implemented: POST /experiments');
        },
      },

      '/logs': {
        post: async () => {
          return {
            body: { data: { id: 'log-id', type: 'logs' } },
            status: 201,
          };
        },
        get: async () => {
          throw new Error('Not implemented: GET /logs');
        },
      },

      '/logs/{id}': {
        get: async () => {
          throw new Error('Not implemented: GET /logs/{id}');
        },
      },

      '/sessions': {
        post: async () => {
          throw new Error('Not implemented: POST /sessions');
        },
      },

      '/sessions/{id}': {
        get: async () => {
          const sessionRuns = Array.from(this.#runs.values(), (r) => ({
            type: 'runs' as const,
            id: r.runId,
          }));
          return {
            status: 200,
            body: {
              data: {
                type: 'sessions',
                id: 'current',
                attributes: { role: 'participant' },
                relationships: { runs: { data: sessionRuns } },
              },
            },
          };
        },
        delete: async () => {
          return { status: 200, body: { data: null } };
        },
      },

      '/runs': {
        get: async ({ request }) => {
          const queryParams = parseUrlQuery(request.url);
          return {
            status: 200,
            body: {
              data: Array.from(this.#runs.values())
                .filter((r) => {
                  let statusFilter = queryParams['filter[status]'];
                  if (statusFilter == null) {
                    return true;
                  }
                  return statusFilter.includes(r.runStatus);
                })
                .map((r) => ({
                  type: 'runs' as const,
                  id: r.runId,
                  attributes: {
                    status: r.runStatus,
                    name: r.runName ?? null,
                    lastLogNumber: Math.max(
                      0,
                      ...r.lastLogs.map((log) => log.number),
                    ),
                    missingLogNumbers: [],
                  },
                  relationships: {
                    experiment: {
                      data: {
                        type: 'experiments' as const,
                        id: r.experimentId,
                      },
                    },
                    lastLogs: {
                      data: r.lastLogs.map((log) => ({
                        type: 'logs' as const,
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
            },
          };
        },
        post: async () => {
          return {
            body: { data: { type: 'runs', id: 'default-run-id' } },
            status: 201,
          };
        },
      },

      '/runs/{id}': {
        get: async () => {
          throw new Error('Not implemented: GET /runs/{id}');
        },
        patch: async ({ params, body }) => {
          const run = this.#runs.get(params.id as string);
          if (run == null) {
            return {
              body: {
                errors: [{ status: 'Not Found', code: 'RUN_NOT_FOUND' }],
              },
              status: 404,
            };
          }
          run.runStatus = body.data.attributes?.status ?? run.runStatus;
          const lastLogNumber = body.data.attributes?.lastLogNumber;
          if (lastLogNumber != null) {
            run.lastLogs = run.lastLogs.filter(
              (l) => l.number <= lastLogNumber,
            );
          }

          return {
            status: 200,
            body: {
              data: {
                id: run.runId,
                type: 'runs' as const,
                attributes: {
                  name: run.runName ?? null,
                  status: run.runStatus,
                  lastLogNumber: Math.max(
                    0,
                    ...run.lastLogs.map((l) => l.number),
                  ),
                  missingLogNumbers: [],
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
            },
          };
        },
      },
    };
    const mockedHandlers = {} as MockedHandlerMap;
    for (const path of Object.keys(handlers) as Array<keyof HandlerMap>) {
      // @ts-expect-error We will fill this in later.
      mockedHandlers[path] = {};
      for (const method in handlers[path]) {
        // @ts-expect-error We know it will be a valid method.
        mockedHandlers[path][method] = vi.fn(handlers[path][method]);
      }
    }
    return mockedHandlers;
  }

  *#createMswHandlers(): Generator<RequestHandler> {
    for (const path of Object.keys(this.handlers) as Array<keyof HandlerMap>) {
      for (const method of Object.keys(
        this.handlers[path],
      ) as Array<HttpMethod>) {
        const handler: BaseServerHandler =
          // @ts-expect-error We know it will be a valid handler.
          this.handlers[path][method];
        yield this.#createMswHandler(path, method as HttpMethod, handler);
      }
    }
  }

  #createMswHandler(
    path: string,
    method: HttpMethod,
    requestHandler: BaseServerHandler,
  ) {
    const resolverPath = `${this.#baseUrl}${translatePath(path)}`;
    return http[method](resolverPath, async (info) => {
      try {
        checkHeaders(info.request);
      } catch (err: unknown) {
        if (!(err instanceof Error)) {
          throw new Error(
            `Unexpected error type: ${typeof err}. Expected an Error.`,
          );
        }
        return HttpResponse.json(
          { errors: [{ message: err.message }] },
          { status: 400 },
        );
      }
      const { body, status } = await requestHandler({
        params: info.params,
        body: info.request.body == null ? undefined : await info.request.json(),
        request: info.request,
      });
      return HttpResponse.json(body, { status: status ?? 200 });
    });
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

function checkHeaders(request: StrictRequest<any>) {
  if (request.body == null) return;
  const actualContentType = request.headers.get('content-type');
  if (actualContentType !== apiMediaType) {
    throw new Error(
      `Expected 'content-type' header to be '${apiMediaType}', but got '${actualContentType}'`,
    );
  }
}

function translatePath(str: string): string {
  return str.replaceAll(/{([^}]+)}/g, (_, p1) => `:${p1}`);
}
