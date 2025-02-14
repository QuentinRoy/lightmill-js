import type {
  Error as ApiErrorResponse,
  Response as ApiOkResponse,
  Path,
  Body as ApiBody,
  Method,
  PathParams,
} from '@lightmill/log-api';
import {
  HttpHandler,
  HttpResponse,
  HttpResponseResolver,
  RequestHandler,
  http,
} from 'msw';

export function getServerHandlers({
  runs = [],
  baseUrl = 'https://server.test/api',
}: {
  runs?: Array<{
    runName: string;
    experimentName: string;
    runStatus?: 'completed' | 'canceled' | 'running';
    logs?: Array<{
      type: string;
      count: number;
      lastNumber: number;
      pending: number;
    }>;
  }>;
  baseUrl?: string;
} = {}): RequestHandler[] {
  function getRun(params: {
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
    return runs.find(
      (r) =>
        runNames.includes(r.runName) &&
        experimentNames.includes(r.experimentName),
    );
  }

  const { get, delete: del, put, post, patch } = createMethods(baseUrl);

  return [
    get('/sessions/current', () =>
      HttpResponse.json({
        status: 'ok',
        role: 'participant',
        runs: runs.map((run) => ({ runStatus: 'running' as const, ...run })),
      }),
    ),
    put('/sessions/current', () =>
      HttpResponse.json({
        status: 'ok',
        role: 'participant',
        runs: runs.map((run) => ({ runStatus: 'running', ...run })),
      }),
    ),
    del('/sessions/current', () => HttpResponse.json({ status: 'ok' })),
    post('/runs', async ({ request }) => {
      let body = await request.json();
      return HttpResponse.json({
        status: 'ok',
        runStatus: 'running',
        runName: body?.runName ?? 'default-run-id',
        experimentName: body?.experimentName ?? 'default-experiment-id',
      });
    }),
    get('/experiments/:experimentName/runs/:runName', ({ params }) => {
      const run = getRun(params);
      if (run == null) {
        return HttpResponse.json(
          { status: 'error', message: 'Run not found' },
          { status: 404 },
        );
      }
      return HttpResponse.json({
        status: 'ok',
        run: { runStatus: 'running', logs: [], ...run },
      });
    }),
    patch('/experiments/:experimentName/runs/:runName', ({ params }) => {
      const run = getRun(params);
      if (run == null) {
        return HttpResponse.json(
          { status: 'error', message: 'Run not found' },
          { status: 404 },
        );
      }
      return HttpResponse.json({ status: 'ok' });
    }),
    post('/experiments/:experimentName/runs/:runName/logs', ({ params }) => {
      const run = getRun(params);
      if (run == null) {
        return HttpResponse.json(
          { status: 'error', message: 'Run not found' },
          { status: 404 },
        );
      }
      return HttpResponse.json({ status: 'ok' });
    }),
  ];
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

  return result as {
    [K in Method]: <P extends Path<K>>(
      path: P,
      handler: HttpResponseResolver<
        // PathParams allow stuff like number or booleans, but msw does not.
        {
          [Key in keyof PathParams<K, P>]: PathParams<
            K,
            P
          >[Key] extends unknown[]
            ? string[]
            : string;
        },
        ApiBody<K, P>,
        ApiOkResponse<K, P> | ApiErrorResponse<K, P>
      >,
    ) => HttpHandler;
  };
}
