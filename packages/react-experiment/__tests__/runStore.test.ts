import { Client } from '@lightmill/log-client';
import { serverTest, type TestServer } from '@lightmill/test-server';
import { expect, vi } from 'vitest';
import { getRunStore, type RunStore } from '../src/runStore.js';

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
});
