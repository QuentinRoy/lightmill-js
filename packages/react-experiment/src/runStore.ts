import type { MaybeAsyncIterator } from '@lightmill/runner';
import type { RegisteredLog, RegisteredTask } from './config.js';
import {
  hasEnded,
  isLive,
  type ResumeLog,
  type RunClient,
  type RunInfo,
  type RunLogger,
} from './logClient.js';
import type { AnyIteratorOrIterable } from './playerState.js';

export type RunState =
  | { status: 'looking-up' }
  | {
      status: 'awaiting-confirmation';
      run: RunInfo;
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
      // The timeline ran out of tasks. The run is not completed yet.
      timelineExhausted: boolean;
    }
  | {
      status: 'error';
      error: unknown;
      // Set when the run crashed after it started: its logs may be held.
      logger: RunLogger | null;
    };

export type TimelineBuilder = (args: {
  resumeLog: ResumeLog | null;
}) => AnyIteratorOrIterable<RegisteredTask>;

export type RunStore = {
  // Tells apart two stores of the same run, one after the other.
  readonly id: number;
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => RunState;
  /**
   * The timeline that `build` makes once the run is ready, as an iterator
   * that is the same object at every call: the player keeps its place in it
   * across remounts. Returns null until then, or while `build` is null. The
   * first builder seen when the run is ready is the one used. Once the
   * iterator is exhausted, the state's `timelineExhausted` is true.
   */
  getTimeline: (
    build: TimelineBuilder | null,
  ) => MaybeAsyncIterator<RegisteredTask> | null;
  /**
   * Resumes the run found by the lookup. Calling it again, or when no run
   * awaits confirmation, does nothing.
   */
  resume: () => void;
  /** Completes the run. Calling it again returns the first call's promise. */
  completeRun: () => Promise<void>;
  /**
   * Fails a ready run and interrupts it, so a reload lands on the resume
   * prompt. The first failure wins. If the interrupt cannot flush the held
   * logs, it is tried again each time the logger goes idle.
   */
  crash: (error: unknown) => void;
};

export type RunIdentity = {
  client: RunClient;
  experimentName: string;
  runName: string;
};

export type RunStoreParams = RunIdentity & {
  // Only read when the store is created.
  resumableLogTypes: Array<RegisteredLog['type']>;
};

export function isSameRun(a: RunIdentity, b: RunIdentity): boolean {
  return (
    a.client === b.client &&
    a.experimentName === b.experimentName &&
    a.runName === b.runName
  );
}

const maxInterruptRetries = 5;
const interruptRetryDelayMs = 1000;

const stores = new WeakMap<RunClient, Map<string, RunStore>>();
let storeCount = 0;

/**
 * The store of a run, shared by every `Run` of the same client, experiment
 * name and run name. Idempotent, so it is safe to call while rendering.
 */
export function getRunStore(params: RunStoreParams): RunStore {
  const { client, experimentName, runName } = params;
  let clientStores = stores.get(client);
  if (clientStores == null) {
    clientStores = new Map();
    stores.set(client, clientStores);
  }
  const key = JSON.stringify([experimentName, runName]);
  let store = clientStores.get(key);
  if (store == null) {
    const clientStoresRef = clientStores;
    store = createRunStore(params, () => {
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
  { client, experimentName, runName, resumableLogTypes }: RunStoreParams,
  evict: () => void,
): RunStore {
  const listeners = new Set<() => void>();
  let state: RunState = { status: 'looking-up' };
  let started = false;
  let timeline: MaybeAsyncIterator<RegisteredTask> | null = null;
  let completion: Promise<void> | null = null;
  // The builder runs once even when it throws.
  let builderFailure: { error: unknown } | null = null;
  let crashedLogger: RunLogger | null = null;
  let interrupting = false;
  // Failed interrupts since the logger last went idle.
  let interruptFailures = 0;
  let interruptTimer: ReturnType<typeof setTimeout> | undefined;

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
      if (loggerState.status === 'idle' && logger === crashedLogger) {
        interruptFailures = 0;
        interrupt(logger);
      }
      if (hasEnded(loggerState)) {
        clearTimeout(interruptTimer);
        evict();
      }
    });
    setState({ status: 'ready', logger, resumeLog, timelineExhausted: false });
  }

  function fail(error: unknown) {
    evict();
    setState({ status: 'error', error, logger: null });
  }

  // Never throws and never replaces the error that crashed the run: the
  // failure is logged, and the logger being live, the held logs stay in it.
  // The logger may not change state again after a failure (a refused request,
  // an idle event that came while interrupting), so a failure schedules
  // another try, with a growing delay and a limit.
  function interrupt(logger: RunLogger) {
    if (interrupting || !isLive(logger.state)) return;
    clearTimeout(interruptTimer);
    interrupting = true;
    logger.interruptRun().then(
      () => {
        interrupting = false;
      },
      (interruptError: unknown) => {
        interrupting = false;
        // The error slot shows the crash; nothing else can show this.
        // eslint-disable-next-line no-console
        console.warn(
          'Could not interrupt the run after it crashed',
          interruptError,
        );
        if (interruptFailures >= maxInterruptRetries) return;
        interruptTimer = setTimeout(
          () => interrupt(logger),
          interruptRetryDelayMs * 2 ** interruptFailures++,
        );
      },
    );
  }

  // The run store knows the timeline is over before the player renders it as
  // completed, and keeps knowing after the player is remounted.
  function exhaustTimeline() {
    if (state.status !== 'ready' || state.timelineExhausted) return;
    setState({ ...state, timelineExhausted: true });
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
    getTimeline(build) {
      if (timeline != null) return timeline;
      if (builderFailure != null) throw builderFailure.error;
      if (state.status !== 'ready' || build == null) return null;
      try {
        timeline = toIterator(
          build({ resumeLog: state.resumeLog }),
          exhaustTimeline,
        );
      } catch (error) {
        builderFailure = { error };
        throw error;
      }
      return timeline;
    },
    crash(error) {
      if (state.status !== 'ready') return;
      const { logger } = state;
      crashedLogger = logger;
      setState({ status: 'error', error, logger });
      interrupt(logger);
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

// Reads the timeline once, so that remounted players share the iterator, and
// reports when it runs out.
function toIterator(
  timeline: AnyIteratorOrIterable<RegisteredTask>,
  onExhausted: () => void,
): MaybeAsyncIterator<RegisteredTask> {
  const iterator =
    Symbol.iterator in timeline
      ? timeline[Symbol.iterator]()
      : Symbol.asyncIterator in timeline
        ? timeline[Symbol.asyncIterator]()
        : timeline;
  const check = (result: IteratorResult<RegisteredTask>) => {
    if (result.done) onExhausted();
    return result;
  };
  return {
    next() {
      const result = iterator.next();
      return 'then' in result ? result.then(check) : check(result);
    },
  };
}
