import { bypass, http, HttpResponse, passthrough } from 'msw';
import { describe, expect } from 'vitest';
import { LightmillClient } from '../src/client.js';
import { LightmillLogger } from '../src/logger.js';
import { RequestError } from '../src/utils.js';
import { serverTest } from './test-server.ts';

const experimentName = 'test-experiment';
const otherExperimentName = 'other-experiment';
const date = new Date('2022-12-31T23:00:00.000Z');

const it = serverTest.extend<{ client: LightmillClient }>({
  client: async ({ server }, use) => {
    await use(new LightmillClient({ apiRoot: server.apiRoot }));
  },
});

it.beforeEach(async ({ server }) => {
  // First, so a lookup that forgets to filter by name finds the wrong one.
  await server.addExperiment(otherExperimentName);
  await server.addExperiment(experimentName);
});

type Logger = Awaited<ReturnType<LightmillClient['startRun']>>;

// Interrupted is not an ended run: it stays ongoing, and can be resumed.
const stopRun = {
  completed: (logger: Logger) => logger.completeRun(),
  canceled: (logger: Logger) => logger.cancelRun(),
  interrupted: (logger: Logger) => logger.interruptRun(),
};

// Starts a run through the client, like a page that has since been closed.
async function seedRun(
  client: LightmillClient,
  {
    runName,
    logs = [],
    stop,
  }: {
    runName: string;
    logs?: Array<{ type: string; values?: Record<string, string> }>;
    stop?: keyof typeof stopRun;
  },
) {
  const logger = await client.startRun({ experimentName, runName });
  await Promise.all(
    logs.map(({ type, values }) => logger.addLog({ type, date, ...values })),
  );
  if (stop != null) await stopRun[stop](logger);
  return logger;
}

describe('LogClient#getResumableRuns', () => {
  // A session has at most one ongoing run, whatever its status.
  for (const status of ['running', 'interrupted'] as const) {
    it(`should fetch the ${status} run`, async ({ client }) => {
      await seedRun(client, {
        runName: 'run-1',
        stop: status === 'interrupted' ? status : undefined,
        logs: [
          { type: 'test-type', values: { prop: 'value-1' } },
          { type: 'other-type', values: { prop: 'value-2' } },
        ],
      });
      await expect(
        client.getResumableRuns({ resumableLogTypes: ['test-type'] }),
      ).resolves.toEqual([
        {
          experiment: { id: expect.any(String), name: experimentName },
          run: { id: expect.any(String), name: 'run-1', status },
          toResumeAfter: {
            number: 1,
            log: {
              type: 'test-type',
              prop: 'value-1',
              date: date.toISOString(),
            },
          },
        },
      ]);
    });
  }

  it('should ignore ended runs', async ({ client }) => {
    const logs = [{ type: 'test-type' }];
    await seedRun(client, { runName: 'run-1', stop: 'canceled', logs });
    await seedRun(client, { runName: 'run-2', stop: 'completed', logs });
    await seedRun(client, { runName: 'run-3', stop: 'interrupted', logs });
    await expect(
      client.getResumableRuns({ resumableLogTypes: ['test-type'] }),
    ).resolves.toEqual([
      expect.objectContaining({
        run: expect.objectContaining({ name: 'run-3', status: 'interrupted' }),
      }),
    ]);
  });

  it('should pick the highest last log of the resumable types', async ({
    client,
  }) => {
    await seedRun(client, {
      runName: 'run-name',
      logs: [
        { type: 'test-type-1' },
        { type: 'test-type-2' },
        { type: 'test-type-1' },
        { type: 'other-type' },
      ],
    });
    await expect(
      client.getResumableRuns({
        resumableLogTypes: ['test-type-1', 'test-type-2'],
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        toResumeAfter: {
          number: 3,
          log: { type: 'test-type-1', date: date.toISOString() },
        },
      }),
    ]);
  });

  it('should return an empty array if no resumable runs are found', async ({
    client,
  }) => {
    await seedRun(client, {
      runName: 'run-name',
      stop: 'completed',
      logs: [{ type: 'test-type' }],
    });
    await expect(
      client.getResumableRuns({ resumableLogTypes: ['test-type'] }),
    ).resolves.toEqual([]);
  });

  it('should suggest to resume from the start if no resumable logs are found', async ({
    client,
  }) => {
    await seedRun(client, {
      runName: 'run-name',
      logs: [{ type: 'other-type' }],
    });
    await expect(
      client.getResumableRuns({ resumableLogTypes: ['test-type'] }),
    ).resolves.toEqual([
      expect.objectContaining({ toResumeAfter: { number: 0, log: null } }),
    ]);
  });

  // The server allows one ongoing run per session, but the client should not
  // rely on it. The server's own answer is stretched to two runs.
  it('should handle several resumable runs', async ({ server, client }) => {
    await seedRun(client, {
      runName: 'run-1',
      logs: [{ type: 'test-type', values: { prop: 'value-1' } }],
    });
    server.msw.use(
      http.get(server.url('/runs'), async ({ request }) => {
        const body = await (await fetch(bypass(request))).json();
        const [run] = body.data;
        const log = body.included.find(
          (resource: { type: string }) => resource.type === 'logs',
        );
        body.data.push({
          ...run,
          id: 'run-2-id',
          attributes: {
            ...run.attributes,
            name: 'run-2',
            status: 'interrupted',
          },
          relationships: {
            ...run.relationships,
            lastLogs: { data: [{ type: 'logs', id: 'log-2-id' }] },
          },
        });
        body.included.push({
          ...log,
          id: 'log-2-id',
          attributes: {
            ...log.attributes,
            number: 7,
            values: { ...log.attributes.values, prop: 'value-2' },
          },
        });
        return HttpResponse.json(body);
      }),
    );
    await expect(
      client.getResumableRuns({ resumableLogTypes: ['test-type'] }),
    ).resolves.toEqual([
      expect.objectContaining({
        run: expect.objectContaining({ name: 'run-1', status: 'running' }),
        toResumeAfter: expect.objectContaining({ number: 1 }),
      }),
      expect.objectContaining({
        run: expect.objectContaining({ name: 'run-2', status: 'interrupted' }),
        toResumeAfter: {
          number: 7,
          log: { type: 'test-type', prop: 'value-2', date: date.toISOString() },
        },
      }),
    ]);
  });

  it('should reject when a failed response has no body', async ({
    server,
    client,
  }) => {
    server.msw.use(
      http.get(
        server.url('/sessions/:id'),
        () =>
          new HttpResponse(null, {
            status: 500,
            headers: { 'Content-Length': '0' },
          }),
      ),
    );
    await expect(
      client.getResumableRuns({ resumableLogTypes: [] }),
    ).rejects.toMatchObject({ name: 'RequestError', status: 500 });
  });

  it('should only return runs matching the experiment and run names', async ({
    client,
  }) => {
    await seedRun(client, { runName: 'run-1' });
    const resumableRuns = (options: {
      experimentName?: string;
      runName?: string;
    }) =>
      client
        .getResumableRuns({ resumableLogTypes: [], ...options })
        .then((runs) => runs.map((r) => `${r.experiment.name}/${r.run.name}`));
    await expect(
      resumableRuns({ experimentName, runName: 'run-1' }),
    ).resolves.toEqual([`${experimentName}/run-1`]);
    await expect(resumableRuns({ runName: 'run-2' })).resolves.toEqual([]);
    await expect(
      resumableRuns({ experimentName: otherExperimentName }),
    ).resolves.toEqual([]);
  });
});

describe('LogClient#startRun', () => {
  it('should create a run without a run name', async ({ server, client }) => {
    const logger = await client.startRun({ experimentName });
    expect(logger).toBeInstanceOf(LightmillLogger);
    await expect(server.storedRuns()).resolves.toEqual([
      { runName: null, runStatus: 'running' },
    ]);
  });

  it('should create a run with a run name', async ({ server, client }) => {
    const logger = await client.startRun({
      experimentName,
      runName: 'test-run',
    });
    expect(logger).toBeInstanceOf(LightmillLogger);
    await expect(server.storedRuns()).resolves.toEqual([
      { runName: 'test-run', runStatus: 'running' },
    ]);
  });

  describe('without a session', () => {
    it('should create one, and send it with every request', async ({
      client,
    }) => {
      await client.startRun({ experimentName, runName: 'test-run' });
      // Only the session that created a run sees it. It also needs its cookie
      // to look up the experiment and to create the run.
      await expect(
        client.getResumableRuns({ resumableLogTypes: [] }),
      ).resolves.toEqual([
        expect.objectContaining({
          run: expect.objectContaining({ name: 'test-run' }),
        }),
      ]);
    });

    it('should fail if the session cannot be created', async ({
      server,
      client,
    }) => {
      server.msw.use(
        http.post(
          server.url('/sessions'),
          () =>
            HttpResponse.json(
              {
                errors: [{ status: 'Forbidden', code: 'INVALID_CREDENTIALS' }],
              },
              { status: 403 },
            ),
          { once: true },
        ),
      );
      await expect(client.startRun({ experimentName })).rejects.toThrow(
        RequestError,
      );
      await expect(server.storedRuns()).resolves.toEqual([]);
    });
  });

  // The server lists the newest run first and a session has one ongoing run,
  // so a lookup without filters would still find this run: check the query.
  it('should look a run up by its experiment and run names', async ({
    server,
    client,
  }) => {
    await seedRun(client, { runName: 'test-run', stop: 'interrupted' });
    const queries: Array<Record<string, string>> = [];
    server.msw.use(
      http.get(server.url('/runs'), ({ request }) => {
        queries.push(
          Object.fromEntries(new URL(request.url).searchParams.entries()),
        );
        return passthrough();
      }),
    );
    await new LightmillClient({ apiRoot: server.apiRoot }).startRun({
      runName: 'test-run',
      experimentName,
      after: { number: 0 },
    });
    expect(queries).toEqual([
      { 'filter[experiment.name]': experimentName, 'filter[name]': 'test-run' },
    ]);
  });

  it('should resume an existing run if after is provided', async ({
    server,
    client,
  }) => {
    await seedRun(client, {
      runName: 'test-run',
      stop: 'interrupted',
      logs: ['a', 'b', 'c', 'd', 'e', 'f'].map((step) => ({
        type: 'step',
        values: { step },
      })),
    });
    // A page reload: a new client, with the same session cookie.
    const resumedClient = new LightmillClient({ apiRoot: server.apiRoot });
    const logger = await resumedClient.startRun({
      runName: 'test-run',
      experimentName,
      after: { number: 4 },
    });
    await logger.addLog({ type: 'step', date, step: 'new' });
    await expect(server.storedRuns()).resolves.toEqual([
      { runName: 'test-run', runStatus: 'running' },
    ]);
    await expect(
      server.storedLogs().then((logs) => logs.map((l) => l.values.step)),
    ).resolves.toEqual(['a', 'b', 'c', 'd', 'new']);
  });

  it('should be able to resume an existing run from the start', async ({
    server,
    client,
  }) => {
    await seedRun(client, {
      runName: 'test-run',
      stop: 'interrupted',
      logs: [{ type: 'step', values: { step: 'old' } }],
    });
    const logger = await client.startRun({
      runName: 'test-run',
      experimentName,
      after: { number: 0 },
    });
    await logger.addLog({ type: 'step', date, step: 'new' });
    await expect(
      server.storedLogs().then((logs) => logs.map((l) => l.values.step)),
    ).resolves.toEqual(['new']);
  });

  it('should reject with the error the server answers with', async ({
    client,
  }) => {
    await client.startRun({ experimentName });
    await expect(
      client.startRun({ runId: 'unknown-run', after: { number: 0 } }),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(RequestError);
      expect(error).toMatchObject({ code: 'RUN_NOT_FOUND' });
      return true;
    });
  });
});

describe('LogClient#logout', () => {
  it('should end the session', async ({ client }) => {
    await client.startRun({ experimentName, runName: 'test-run' });
    await client.logout();
    // The session, with its run, is gone: the client has no run to resume.
    await expect(
      client.getResumableRuns({ resumableLogTypes: [] }),
    ).resolves.toEqual([]);
  });

  it('should reject without a session', async ({ client }) => {
    await expect(client.logout()).rejects.toBeInstanceOf(RequestError);
  });
});
