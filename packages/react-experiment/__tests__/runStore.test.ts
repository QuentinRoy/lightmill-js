import { Client } from '@lightmill/log-client';
import { serverTest, type TestServer } from '@lightmill/test-server';
import { http, HttpResponse } from 'msw';
import { expect, vi } from 'vitest';
import { getRunStore, type RunStore } from '../src/runStore.js';
import { failDelivery } from './runTestUtils.js';

function identity(
  server: TestServer,
  overrides: Partial<Parameters<typeof getRunStore>[0]> = {},
) {
  return {
    client: new Client({ apiRoot: server.apiRoot }),
    experimentName: 'exp',
    runName: 'run-1',
    resumableLogTypes: ['trial-done'],
    ...overrides,
  };
}

function failRequest(server: TestServer, method: 'patch', path: string) {
  server.msw.use(
    http[method](`${server.apiRoot}${path}`, () =>
      HttpResponse.json(
        { errors: [{ status: '400', detail: 'Refused' }] },
        { status: 400 },
      ),
    ),
  );
}

function whenStatus(store: RunStore, status: string) {
  return vi.waitFor(() => {
    expect(store.getSnapshot().status).toBe(status);
  });
}

describe('run store', () => {
  serverTest(
    'is created once per client, experiment name and run name',
    async ({ server }) => {
      const id = identity(server);
      const store = getRunStore(id);

      expect(getRunStore({ ...id })).toBe(store);
      expect(getRunStore({ ...id, runName: 'run-2' })).not.toBe(store);
      expect(getRunStore({ ...id, experimentName: 'other' })).not.toBe(store);
      expect(getRunStore(identity(server))).not.toBe(store);
    },
  );

  serverTest('looks the run up when first subscribed', async ({ server }) => {
    await server.addExperiment('exp');
    const store = getRunStore(identity(server));
    expect(store.getSnapshot().status).toBe('looking-up');
    expect(server.requestCount('GET', /sessions/)).toBe(0);

    const unsubscribe = store.subscribe(() => {});
    await whenStatus(store, 'ready');

    expect(server.requestCount('GET', /sessions/)).toBeGreaterThan(0);
    unsubscribe();
  });

  serverTest(
    'keeps starting the run when its only subscriber leaves',
    async ({ server }) => {
      await server.addExperiment('exp');
      const store = getRunStore(identity(server));
      store.subscribe(() => {})();
      store.subscribe(() => {})();

      await whenStatus(store, 'ready');
      expect(server.requestCount('POST', '/runs')).toBe(1);
    },
  );

  serverTest('is replaced once its logger ends', async ({ server }) => {
    await server.addExperiment('exp');
    const id = identity(server);
    const store = getRunStore(id);
    store.subscribe(() => {});
    await whenStatus(store, 'ready');
    expect(getRunStore(id)).toBe(store);

    await store.completeRun();

    expect(getRunStore(id)).not.toBe(store);
  });

  serverTest(
    'is replaced after the run failed to start',
    async ({ server }) => {
      // The experiment does not exist.
      const id = identity(server);
      const store = getRunStore(id);
      store.subscribe(() => {});

      await whenStatus(store, 'error');

      expect(getRunStore(id)).not.toBe(store);
    },
  );

  describe('when the run crashes', () => {
    async function readyStore(server: TestServer) {
      await server.addExperiment('exp');
      const id = identity(server);
      const store = getRunStore(id);
      store.subscribe(() => {});
      await whenStatus(store, 'ready');
      return { id, store };
    }

    beforeEach(() => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    serverTest(
      'keeps the first error, and interrupts the run until its logger ends',
      async ({ server }) => {
        const { id, store } = await readyStore(server);
        const first = new Error('First');

        store.crash(first);
        store.crash(new Error('Second'));

        expect(store.getSnapshot()).toMatchObject({
          status: 'error',
          error: first,
        });
        await vi.waitFor(async () => {
          await expect(server.storedRuns()).resolves.toEqual([
            { runName: 'run-1', runStatus: 'interrupted' },
          ]);
        });
        // The logger ended: a reload gets another store.
        expect(getRunStore(id)).not.toBe(store);
      },
    );

    serverTest(
      'is not replaced while its logger is live',
      async ({ server }) => {
        const { id, store } = await readyStore(server);
        failRequest(server, 'patch', '/runs/:id');

        store.crash(new Error('Crash'));
        await vi.waitFor(() => {
          expect(console.warn).toHaveBeenCalled();
        });

        expect(getRunStore(id)).toBe(store);
      },
    );

    serverTest(
      'tries to interrupt again when the logger goes idle after a failed flush',
      async ({ server }) => {
        const { store } = await readyStore(server);
        const state = store.getSnapshot();
        if (state.status !== 'ready') throw new Error('Not ready');
        const { logger } = state;
        const fault = failDelivery(server);
        void logger.addLog({ type: 'trial-done', taskId: 'a' }).catch(() => {});
        await vi.waitFor(() => {
          expect(logger.state.status).toBe('paused');
        });

        store.crash(new Error('Crash'));
        await vi.waitFor(() => {
          expect(console.warn).toHaveBeenCalledTimes(1);
        });
        expect(logger.state.status).toBe('paused');
        await expect(server.storedRuns()).resolves.toEqual([
          { runName: 'run-1', runStatus: 'running' },
        ]);

        fault.clear();
        await logger.retry();

        await vi.waitFor(async () => {
          await expect(server.storedRuns()).resolves.toEqual([
            { runName: 'run-1', runStatus: 'interrupted' },
          ]);
        });
        await expect(server.storedLogs()).resolves.toHaveLength(1);
      },
    );

    serverTest(
      'ignores a crash before the run is ready',
      async ({ server }) => {
        await server.addExperiment('exp');
        const store = getRunStore(identity(server));

        store.crash(new Error('Too early'));

        expect(store.getSnapshot().status).toBe('looking-up');
      },
    );
  });

  serverTest(
    'builds the timeline once, when the run is ready and a builder is given',
    async ({ server }) => {
      await server.addExperiment('exp');
      const store = getRunStore(identity(server));
      store.subscribe(() => {});
      const build = vi.fn(() => [{ type: 'trial' }]);

      expect(store.getPlayerStore(build)).toBeNull();
      await whenStatus(store, 'ready');
      expect(store.getPlayerStore(null)).toBeNull();
      const playerStore = store.getPlayerStore(build);

      expect(playerStore).not.toBeNull();
      expect(store.getPlayerStore(build)).toBe(playerStore);
      expect(store.getPlayerStore(() => [])).toBe(playerStore);
      expect(build).toHaveBeenCalledExactlyOnceWith({ resumeLog: null });
    },
  );

  describe('with an ongoing run', () => {
    // Starts a run with one stored log, then forgets about its logger, as a
    // reload does.
    async function leaveRun(server: TestServer, runName = 'run-1') {
      const client = new Client({ apiRoot: server.apiRoot });
      const logger = await client.startRun({ experimentName: 'exp', runName });
      await logger.addLog({ type: 'trial-done', taskId: 'a' });
    }

    serverTest(
      'waits for confirmation, with the run and its last resumable log',
      async ({ server }) => {
        await server.addExperiment('exp');
        await leaveRun(server);
        const store = getRunStore(identity(server));
        store.subscribe(() => {});

        await whenStatus(store, 'awaiting-confirmation');

        expect(store.getSnapshot()).toMatchObject({
          run: { name: 'run-1', status: 'running' },
          lastLog: { type: 'trial-done', taskId: 'a' },
        });
        expect(server.requestCount('PATCH', /^\/runs\//)).toBe(0);
      },
    );

    serverTest(
      'has no last log when nothing resumable was logged',
      async ({ server }) => {
        await server.addExperiment('exp');
        await leaveRun(server);
        const store = getRunStore(
          identity(server, { resumableLogTypes: ['other-type'] }),
        );
        store.subscribe(() => {});

        await whenStatus(store, 'awaiting-confirmation');

        expect(store.getSnapshot()).toMatchObject({ lastLog: null });
      },
    );

    serverTest(
      'resumes once however often resume is called, then builds with the last log',
      async ({ server }) => {
        await server.addExperiment('exp');
        await leaveRun(server);
        const store = getRunStore(identity(server));
        store.subscribe(() => {});
        await whenStatus(store, 'awaiting-confirmation');

        store.resume();
        store.resume();
        await whenStatus(store, 'ready');
        store.resume();

        expect(server.requestCount('PATCH', /^\/runs\//)).toBe(1);
        const build = vi.fn(() => [{ type: 'trial' }]);
        store.getPlayerStore(build);
        expect(build).toHaveBeenCalledExactlyOnceWith({
          resumeLog: expect.objectContaining({
            type: 'trial-done',
            taskId: 'a',
          }),
        });
      },
    );

    serverTest('is replaced after resuming failed', async ({ server }) => {
      await server.addExperiment('exp');
      await leaveRun(server);
      const id = identity(server);
      const store = getRunStore(id);
      store.subscribe(() => {});
      await whenStatus(store, 'awaiting-confirmation');
      server.msw.use(
        http.patch(`${server.apiRoot}/runs/:id`, () =>
          HttpResponse.json({ errors: [{ status: '500' }] }, { status: 500 }),
        ),
      );

      store.resume();
      await whenStatus(store, 'error');

      expect(getRunStore(id)).not.toBe(store);
    });
  });
});
