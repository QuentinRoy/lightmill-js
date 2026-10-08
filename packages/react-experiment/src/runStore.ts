import type { RegisteredLog, RegisteredTask } from './config.js';
import type { ResumeLog, RunClient, RunLogger } from './logClient.js';
import {
  createPlayerStore,
  type AnyIteratorOrIterable,
  type PlayerStore,
} from './playerState.js';

export type RunState =
  | { status: 'looking-up' }
  | {
      status: 'awaiting-confirmation';
      run: { id: string; name: string | null; status: string };
      // The last resumable log, or null at resume number 0.
      lastLog: ResumeLog | null;
      // What the client needs to resume after `lastLog`.
      after: { number: number };
    }
  | { status: 'starting' }
  | {
      status: 'ready';
      logger: RunLogger;
      // The last resumable log, or null for a new run.
      resumeLog: ResumeLog | null;
    }
  | { status: 'error'; error: unknown };

export type TimelineBuilder = (args: {
  resumeLog: ResumeLog | null;
}) => AnyIteratorOrIterable<RegisteredTask>;

export type RunStore = {
  // Tells apart two stores of the same run, one after the other.
  readonly id: number;
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => RunState;
  /**
   * The store of the timeline that `build` makes once the run is ready.
   * Returns null until then, or while `build` is null. The first builder
   * seen when the run is ready is the one used.
   */
  getPlayerStore: (
    build: TimelineBuilder | null,
  ) => PlayerStore<RegisteredTask> | null;
  /**
   * Resumes the run found by the lookup. Calling it again, or when no run
   * awaits confirmation, does nothing.
   */
  resume: () => void;
  /** Completes the run. Calling it again returns the first call's promise. */
  completeRun: () => Promise<void>;
};

export type RunIdentity = {
  client: RunClient;
  experimentName: string;
  runName: string;
  // Only read when the store is created.
  resumableLogTypes: Array<RegisteredLog['type']>;
};

const stores = new WeakMap<RunClient, Map<string, RunStore>>();
let storeCount = 0;

/**
 * The store of a run, shared by every `Run` of the same client, experiment
 * name and run name. Idempotent, so it is safe to call while rendering.
 */
export function getRunStore(identity: RunIdentity): RunStore {
  const { client, experimentName, runName } = identity;
  let clientStores = stores.get(client);
  if (clientStores == null) {
    clientStores = new Map();
    stores.set(client, clientStores);
  }
  const key = JSON.stringify([experimentName, runName]);
  let store = clientStores.get(key);
  if (store == null) {
    const clientStoresRef = clientStores;
    store = createRunStore(identity, () => {
      if (clientStoresRef.get(key) === store) clientStoresRef.delete(key);
    });
    clientStores.set(key, store);
  }
  return store;
}

// The store lives outside React: the run must neither start twice nor be
// forgotten when StrictMode or a remount unsubscribes the component, so
// unsubscribing cancels nothing.
function createRunStore(
  { client, experimentName, runName, resumableLogTypes }: RunIdentity,
  evict: () => void,
): RunStore {
  const listeners = new Set<() => void>();
  let state: RunState = { status: 'looking-up' };
  let started = false;
  let playerStore: PlayerStore<RegisteredTask> | null = null;
  let completion: Promise<void> | null = null;

  const setState = (next: RunState) => {
    state = next;
    listeners.forEach((listener) => listener());
  };

  // Looks the run up and, when there is none, starts a new one.
  async function start() {
    try {
      const [found] = await client.getResumableRuns({
        experimentName,
        runName,
        resumableLogTypes,
      });
      if (found != null) {
        setState({
          status: 'awaiting-confirmation',
          run: found.run,
          lastLog: found.toResumeAfter.log,
          after: { number: found.toResumeAfter.number },
        });
        return;
      }
      setState({ status: 'starting' });
      await begin(client.startRun({ experimentName, runName }), null);
    } catch (error) {
      fail(error);
    }
  }

  async function begin(
    loggerPromise: Promise<RunLogger>,
    resumeLog: ResumeLog | null,
  ) {
    const logger = await loggerPromise;
    logger.subscribe((loggerState) => {
      if (
        loggerState.status === 'completed' ||
        loggerState.status === 'canceled' ||
        loggerState.status === 'interrupted'
      ) {
        evict();
      }
    });
    setState({ status: 'ready', logger, resumeLog });
  }

  function fail(error: unknown) {
    evict();
    setState({ status: 'error', error });
  }

  return {
    id: storeCount++,
    subscribe(listener) {
      listeners.add(listener);
      if (!started) {
        started = true;
        void start();
      }
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => state,
    resume() {
      // Moving to `starting` right away is what makes a second call a no-op.
      if (state.status !== 'awaiting-confirmation') return;
      const { run, lastLog, after } = state;
      setState({ status: 'starting' });
      begin(client.startRun({ runId: run.id, after }), lastLog).catch(fail);
    },
    getPlayerStore(build) {
      if (playerStore != null) return playerStore;
      if (state.status !== 'ready' || build == null) return null;
      playerStore = createPlayerStore({
        timeline: build({ resumeLog: state.resumeLog }),
      });
      return playerStore;
    },
    completeRun() {
      if (state.status !== 'ready') {
        throw new Error('Cannot complete a run that is not ready');
      }
      completion ??= state.logger.completeRun();
      return completion;
    },
  };
}
