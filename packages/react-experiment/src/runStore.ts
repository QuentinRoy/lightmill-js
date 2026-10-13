import type { MaybeAsyncIterator } from '@lightmill/runner';
import type { RegisteredTask } from './config.js';
import { TimelineMismatchError } from './errors.js';
import {
  hasEnded,
  isLive,
  type ResumeLog,
  type RunClient,
  type RunInfo,
  type RunLogger,
} from './logClient.js';
import type {
  AnyIteratorOrIterable,
  TaskResult,
  TimelineNext,
} from './playerState.js';

export type RunState =
  | { status: 'looking-up' }
  | {
      status: 'awaiting-confirmation';
      run: RunInfo;
      // The last completion log, or null at resume number 0.
      lastLog: ResumeLog | null;
      // What the client needs to resume after `lastLog`.
      after: { number: number };
    }
  | { status: 'starting' }
  | {
      status: 'ready';
      logger: RunLogger;
      // The timeline ran out of tasks. The run is not completed yet.
      timelineExhausted: boolean;
    }
  | {
      status: 'error';
      error: unknown;
      // Set when the run crashed after it started: its logs may be held.
      logger: RunLogger | null;
    };

export type RunStore = {
  // Tells apart two stores of the same run, one after the other.
  readonly id: number;
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => RunState;
  /**
   * The timeline once the run is ready and `source` was replayed up to the
   * run's last completed task, as an iterator that is the same object at
   * every call: the player keeps its place in it across remounts. Returns
   * null until then, or while `source` is null. The first `source` seen when
   * the run is ready is the one used. A replay that fails crashes the run.
   * Once the iterator is exhausted, the state's `timelineExhausted` is true.
   */
  getTimeline: (
    source: AnyIteratorOrIterable<RegisteredTask> | null,
  ) => MaybeAsyncIterator<RegisteredTask, TimelineNext> | null;
  /**
   * Resumes the run found by the lookup. Calling it again, or when no run
   * awaits confirmation, does nothing.
   */
  resume: () => void;
  /**
   * Makes `owner`, a `Run` instance, the one that plays the run. Once the run
   * is ready, the owner no longer changes.
   */
  claim: (owner: object) => void;
  /** Whether the run is ready and another `Run` instance plays it. */
  isRemount: (owner: object) => boolean;
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
  taskTypes: Array<RegisteredTask['type']>;
};

export function isSameRun(a: RunIdentity, b: RunIdentity): boolean {
  return (
    a.client === b.client &&
    a.experimentName === b.experimentName &&
    a.runName === b.runName
  );
}

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
  { client, experimentName, runName, taskTypes }: RunStoreParams,
  evict: () => void,
): RunStore {
  const listeners = new Set<() => void>();
  let state: RunState = { status: 'looking-up' };
  let started = false;
  let timeline: MaybeAsyncIterator<RegisteredTask, TimelineNext> | null = null;
  let replayStarted = false;
  let readFailure: { error: unknown } | null = null;
  // The completion logs to replay, in order.
  let completedTasks: ResumeLog[] = [];
  let completion: Promise<void> | null = null;
  let crashedLogger: RunLogger | null = null;
  let owner: object | null = null;
  let interrupting = false;

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
        resumableLogTypes: taskTypes,
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
      await begin(client.startRun({ experimentName, runName }));
    } catch (error) {
      fail(error);
    }
  }

  async function begin(loggerPromise: Promise<RunLogger>) {
    const logger = await loggerPromise;
    logger.subscribe((loggerState) => {
      if (loggerState.status === 'idle' && logger === crashedLogger) {
        interrupt(logger);
      }
      if (hasEnded(loggerState)) evict();
    });
    setState({ status: 'ready', logger, timelineExhausted: false });
  }

  function fail(error: unknown) {
    evict();
    setState({ status: 'error', error, logger: null });
  }

  // Never throws and never replaces the error that crashed the run: the
  // failure is logged, and the logger being live, the held logs stay in it.
  // Nothing retries on a timer: log-client already retried the request, and
  // a refusal does not fix itself. A run left running resumes like an
  // interrupted one.
  function interrupt(logger: RunLogger) {
    if (interrupting || !isLive(logger.state)) return;
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
      },
    );
  }

  async function resume(run: RunInfo, after: { number: number }) {
    const logs = await client.getRunLogs({
      runId: run.id,
      logTypes: taskTypes,
    });
    // Resuming cancels the logs above the resume point, such as those another
    // tab wrote since the lookup.
    completedTasks = logs
      .filter(({ number }) => number <= after.number)
      .map(({ log }) => log);
    await begin(client.startRun({ runId: run.id, after }));
  }

  function crash(error: unknown) {
    if (state.status !== 'ready') return;
    const { logger } = state;
    crashedLogger = logger;
    setState({ status: 'error', error, logger });
    interrupt(logger);
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
      const { run, after } = state;
      setState({ status: 'starting' });
      resume(run, after).catch(fail);
    },
    claim(newOwner) {
      if (state.status !== 'ready' || owner == null) owner = newOwner;
    },
    isRemount(candidate) {
      return state.status === 'ready' && owner != null && owner !== candidate;
    },
    getTimeline(source) {
      if (timeline != null) return timeline;
      // React renders again after a throw, which must throw again.
      if (readFailure != null) throw readFailure.error;
      if (state.status !== 'ready' || source == null || replayStarted) {
        return null;
      }
      replayStarted = true;
      let iterator: MaybeAsyncIterator<RegisteredTask, TimelineNext>;
      try {
        iterator = toIterator(source);
      } catch (error) {
        readFailure = { error };
        throw error;
      }
      if (completedTasks.length === 0) {
        timeline = continueLive(iterator, null, exhaustTimeline);
        return timeline;
      }
      replay(iterator, completedTasks).then((replayed) => {
        timeline = continueLive(iterator, replayed, exhaustTimeline);
        // A new snapshot, so that the player renders with the timeline.
        if (state.status === 'ready') setState({ ...state });
      }, crash);
      return null;
    },
    crash,
    completeRun() {
      if (state.status !== 'ready') {
        throw new Error('Cannot complete a run that is not ready');
      }
      completion ??= state.logger.completeRun();
      return completion;
    },
  };
}

// Reads the timeline once, so that remounted players share the iterator.
function toIterator(
  timeline: AnyIteratorOrIterable<RegisteredTask>,
): MaybeAsyncIterator<RegisteredTask, TimelineNext> {
  return Symbol.iterator in timeline
    ? timeline[Symbol.iterator]()
    : Symbol.asyncIterator in timeline
      ? timeline[Symbol.asyncIterator]()
      : timeline;
}

type Replayed = { lastResult: TaskResult | undefined; taskIds: Set<unknown> };

// Steps the timeline through the completed tasks, passing each one's result
// back as completeTask did, so that a stateful timeline gets back where it
// was. Each task must be the one the run completed at that step.
async function replay(
  iterator: MaybeAsyncIterator<RegisteredTask, TimelineNext>,
  completedTasks: ResumeLog[],
): Promise<Replayed> {
  const taskIds = new Set<unknown>();
  let lastResult: TaskResult | undefined;
  for (const completed of completedTasks) {
    const { type, taskId, date: _date, ...result } = completed;
    const step = await (lastResult === undefined
      ? iterator.next()
      : iterator.next(lastResult));
    if (step.done) {
      throw new TimelineMismatchError(
        `The timeline ended where the run completed task ${String(taskId)} of type ${type}.`,
      );
    }
    if (step.value.type !== type || step.value.id !== taskId) {
      throw new TimelineMismatchError(
        `The timeline yielded task ${String(step.value.id)} of type ${step.value.type} where the run completed task ${String(taskId)} of type ${type}.`,
      );
    }
    taskIds.add(taskId);
    lastResult = result;
  }
  return { lastResult, taskIds };
}

// The timeline after the replay: its first next() call passes on the result
// of the last replayed task. It reports when it runs out.
function continueLive(
  iterator: MaybeAsyncIterator<RegisteredTask, TimelineNext>,
  replayed: Replayed | null,
  onExhausted: () => void,
): MaybeAsyncIterator<RegisteredTask, TimelineNext> {
  let pending = replayed?.lastResult;
  const check = (step: IteratorResult<RegisteredTask>) => {
    if (step.done) {
      onExhausted();
    } else if (replayed?.taskIds.has(step.value.id)) {
      throw new TimelineMismatchError(
        `The timeline yielded task ${String(step.value.id)} again, which the run already completed.`,
      );
    }
    return step;
  };
  return {
    next(...value) {
      const step =
        pending === undefined
          ? iterator.next(...value)
          : iterator.next(pending);
      pending = undefined;
      return 'then' in step ? step.then(check) : check(step);
    },
  };
}
