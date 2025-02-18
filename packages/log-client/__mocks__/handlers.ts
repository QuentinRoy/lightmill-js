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
        role: 'participant',
        runs: runs.map((run) => ({ runStatus: 'running' as const, ...run })),
      }),
    ),
    put('/sessions/current', () =>
      HttpResponse.json({
        role: 'participant',
        runs: runs.map((run) => ({ runStatus: 'running', ...run })),
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
      const run = getRun(params);
      if (run == null) {
        return HttpResponse.json({ message: 'Run not found' }, { status: 404 });
      }
      return HttpResponse.json({
        runStatus: 'running',
        logs: [],
        ...run,
      });
    }),
    patch('/experiments/:experimentName/runs/:runName', ({ params }) => {
      const run = getRun(params);
      if (run == null) {
        return HttpResponse.json({ message: 'Run not found' }, { status: 404 });
      }
      return HttpResponse.json();
    }),
    post('/experiments/:experimentName/runs/:runName/logs', ({ params }) => {
      const run = getRun(params);
      if (run == null) {
        return HttpResponse.json({ message: 'Run not found' }, { status: 404 });
      }
      return HttpResponse.json();
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

  return result;
}
