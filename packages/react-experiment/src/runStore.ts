import type { RegisteredLog, RegisteredTask } from './config.js';
import type { ResumeLog, RunClient, RunLogger } from './logClient.js';
import {
  createPlayerStore,
  type AnyIteratorOrIterable,
  type PlayerStore,
} from './playerState.js';

export type RunState =
  | { status: 'looking-up' }
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

  async function start() {
    try {
      const runs = await client.getResumableRuns({
        experimentName,
        runName,
        resumableLogTypes,
      });
      if (runs.length > 0) {
        throw new Error('Resuming a run is not supported yet.');
      }
      setState({ status: 'starting' });
      const logger = await client.startRun({ experimentName, runName });
      logger.subscribe((loggerState) => {
        if (
          loggerState.status === 'completed' ||
          loggerState.status === 'canceled' ||
          loggerState.status === 'interrupted'
        ) {
          evict();
        }
      });
      setState({ status: 'ready', logger, resumeLog: null });
    } catch (error) {
      evict();
      setState({ status: 'error', error });
    }
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
