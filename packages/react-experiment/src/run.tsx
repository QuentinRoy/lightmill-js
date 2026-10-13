import type { MaybeAsyncIterator } from '@lightmill/runner';
import * as React from 'react';
import type { RegisteredLog, RegisteredTask } from './config.js';
import { DefaultError } from './defaultError.js';
import { DefaultPaused } from './defaultPaused.js';
import { RunRemountedError } from './errors.js';
import { isLive, type RunClient, type RunLogger } from './logClient.js';
import type { TimelineNext } from './playerState.js';
import {
  getRunStore,
  isSameRun,
  type RunIdentity,
  type RunState,
  type RunStore,
  type RunStoreParams,
  type TimelineBuilder,
} from './runStore.js';
import {
  TimelinePlayer,
  type TimelinePlayerElements,
} from './timelinePlayer.js';
import { useConfirmBeforeUnload } from './useConfirmBeforeUnload.js';
import { LogDeliveryProvider } from './useLogDelivery.js';
import { resumeRunContext, useResumeRun } from './useResumeRun.js';
import { runErrorContext } from './useRunError.js';
import { noSubscribe } from './utils.js';

export type RunElements = TimelinePlayerElements<RegisteredTask> & {
  /** Asks the participant to resume an ongoing run. See `useResumeRun`. */
  resume?: React.ReactElement;
  /**
   * Shown when the run cannot start or crashes. Read the thrown value with
   * `useRunError`. It renders outside of `Run`'s error boundary: what it
   * throws reaches the app's.
   */
  error?: React.ReactElement;
};

export type RunProps = {
  /** Create it once: a new client is a new run. */
  client: RunClient;
  experimentName: string;
  runName: string;
  /** Read when the run is looked up. Later changes are ignored. */
  resumableLogTypes: Array<RegisteredLog['type']>;
  /**
   * Builds the timeline, once per run. `null` while the app loads it.
   * `resumeLog` is the last resumable log, or `null` for a new run or when
   * none was logged yet.
   */
  timeline: TimelineBuilder | null;
  elements: RunElements;
  /**
   * Resumes a run found by the lookup without asking: the loading slot shows
   * instead of the resume slot. Use it in development to make reloads
   * painless, never in production: another tab or device playing the same
   * run is resumed silently, and the logs it wrote after the resume point
   * are canceled.
   */
  dangerouslyAutoResume?: boolean;
};

const defaultLoading = <p>Loading…</p>;
function DefaultResume() {
  const { resume } = useResumeRun();
  return (
    <>
      <p>You have a session in progress.</p>
      <button type="button" onClick={resume}>
        Resume
      </button>
    </>
  );
}
const defaultResume = <DefaultResume />;
const defaultCompleted = <p>Thank you, the experiment is complete.</p>;
const defaultPaused = <DefaultPaused />;
const defaultError = <DefaultError />;

/**
 * Runs one run of an experiment: starts it, plays its timeline, logs to the
 * server and completes it. Keep it mounted until the run ends.
 */
export function Run({
  client,
  experimentName,
  runName,
  resumableLogTypes,
  timeline,
  elements,
  dangerouslyAutoResume = false,
}: RunProps): React.JSX.Element {
  const { store, identity, identityChanged } = useRunStore({
    client,
    experimentName,
    runName,
    resumableLogTypes,
  });
  const state = React.useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  // Identifies this instance. StrictMode, Activity and a Fast Refresh that
  // keeps state keep it; a remount does not.
  const [instance] = React.useState(() => ({}));
  const remount =
    identityChanged && state.status === 'ready'
      ? 'identity'
      : store.isRemount(instance)
        ? 'remount'
        : null;
  // A layout effect, so that the loading element does not get painted.
  React.useLayoutEffect(() => {
    if (remount == null) store.claim(instance);
    else store.crash(new RunRemountedError(remount));
  }, [store, instance, remount, state.status]);
  const autoResume =
    dangerouslyAutoResume && state.status === 'awaiting-confirmation';
  React.useEffect(() => {
    if (autoResume) store.resume();
  }, [autoResume, store]);
  const loading = elements.loading ?? defaultLoading;
  // There is no logger before the run starts or when it fails to.
  const logger =
    state.status === 'ready' || state.status === 'error' ? state.logger : null;
  let content: React.ReactNode;
  switch (state.status) {
    case 'looking-up':
    case 'starting':
      content = loading;
      break;
    case 'awaiting-confirmation':
      content = autoResume ? (
        loading
      ) : (
        <ResumeProvider store={store} state={state}>
          {elements.resume ?? defaultResume}
        </ResumeProvider>
      );
      break;
    case 'error':
      content = (
        <ErrorProvider
          error={state.error}
          experimentName={identity.experimentName}
          runName={identity.runName}
        >
          {elements.error ?? defaultError}
        </ErrorProvider>
      );
      break;
    case 'ready':
      // The player must not render: its task would start again.
      if (remount != null) {
        content = loading;
        break;
      }
      content = (
        // Another store is another run: its player starts afresh.
        <CrashBoundary key={store.id} onCrash={store.crash}>
          <RunPlayer
            store={store}
            logger={state.logger}
            timelineExhausted={state.timelineExhausted}
            build={timeline}
            loading={loading}
            elements={elements}
          />
        </CrashBoundary>
      );
      break;
    default: {
      const _exhaustiveCheck: never = state;
      throw new Error('Unhandled run state');
    }
  }
  return (
    <>
      <UnloadGuard logger={logger} crashed={state.status === 'error'} />
      <LogDeliveryProvider logger={logger}>{content}</LogDeliveryProvider>
    </>
  );
}

// The store of the current identity, kept for as long as the identity holds
// even if the store was evicted since: a finished run must not be looked up
// and started again by the next render. A run that started holds on to its
// store until it ends; `identityChanged` tells the identity changed meanwhile.
function useRunStore(params: RunStoreParams): {
  store: RunStore;
  identity: RunIdentity;
  identityChanged: boolean;
} {
  const ref = React.useRef<{ identity: RunIdentity; store: RunStore } | null>(
    null,
  );
  const identity = {
    client: params.client,
    experimentName: params.experimentName,
    runName: params.runName,
  };
  const identityChanged =
    ref.current != null && !isSameRun(ref.current.identity, identity);
  if (
    ref.current == null ||
    (identityChanged && !holdsRun(ref.current.store.getSnapshot()))
  ) {
    ref.current = { identity, store: getRunStore(params) };
    return { ...ref.current, identityChanged: false };
  }
  return { ...ref.current, identityChanged };
}

// After a crash, the error slot stays even once the logger ends.
function holdsRun(state: RunState): boolean {
  if (state.status === 'error') return state.logger != null;
  return state.status === 'ready' && isLive(state.logger.state);
}

function ResumeProvider({
  store,
  state,
  children,
}: {
  store: RunStore;
  state: Extract<RunState, { status: 'awaiting-confirmation' }>;
  children: React.ReactNode;
}) {
  const value = React.useMemo(
    () => ({ resume: store.resume, run: state.run, lastLog: state.lastLog }),
    [store, state],
  );
  return (
    <resumeRunContext.Provider value={value}>
      {children}
    </resumeRunContext.Provider>
  );
}

function ErrorProvider({
  error,
  experimentName,
  runName,
  children,
}: {
  error: unknown;
  experimentName: string;
  runName: string;
  children: React.ReactNode;
}) {
  const value = React.useMemo(
    () => ({ error, experimentName, runName }),
    [error, experimentName, runName],
  );
  return (
    <runErrorContext.Provider value={value}>
      {children}
    </runErrorContext.Provider>
  );
}

// Catches what the player throws: a task bug, a throwing builder, a binding
// error. The store then moves to its error state, so `Run` renders the error
// slot outside of this boundary.
class CrashBoundary extends React.Component<
  { onCrash: (error: unknown) => void; children: React.ReactNode },
  { crashed: boolean }
> {
  state = { crashed: false };
  static getDerivedStateFromError() {
    return { crashed: true };
  }
  componentDidCatch(error: unknown) {
    this.props.onCrash(error);
  }
  render() {
    return this.state.crashed ? null : this.props.children;
  }
}

// Asks the browser to confirm before unloading while the logger is live. After
// a crash, only while logs are held: nothing else is lost by leaving.
function UnloadGuard({
  logger,
  crashed,
}: {
  logger: RunLogger | null;
  crashed: boolean;
}): null {
  const subscribe = logger?.subscribe ?? noSubscribe;
  const live = React.useSyncExternalStore(
    subscribe,
    () => logger != null && isLive(logger.state),
  );
  const held = React.useSyncExternalStore(
    subscribe,
    () => logger != null && logger.inFlightLogs.length > 0,
  );
  useConfirmBeforeUnload(live && (!crashed || held));
  return null;
}

function RunPlayer({
  store,
  logger,
  timelineExhausted,
  build,
  loading,
  elements,
}: {
  store: RunStore;
  logger: RunLogger;
  timelineExhausted: boolean;
  build: TimelineBuilder | null;
  loading: React.ReactElement;
  elements: RunElements;
}): React.JSX.Element {
  const timeline = store.getTimeline(build);
  if (timeline == null) return loading;
  return (
    <ReadyPlayer
      store={store}
      logger={logger}
      timeline={timeline}
      timelineExhausted={timelineExhausted}
      elements={{
        ...elements,
        loading,
        completed: elements.completed ?? defaultCompleted,
        paused: elements.paused ?? defaultPaused,
      }}
    />
  );
}

function ReadyPlayer({
  store,
  logger,
  timeline,
  timelineExhausted,
  elements,
}: {
  store: RunStore;
  logger: RunLogger;
  timeline: MaybeAsyncIterator<RegisteredTask, TimelineNext>;
  timelineExhausted: boolean;
  elements: RunElements;
}): React.JSX.Element | null {
  const loggerState = React.useSyncExternalStore(
    logger.subscribe,
    () => logger.state,
  );
  // Completing the run flushes the logger, which rejects while delivery is
  // paused. Waiting for idle avoids that rejection.
  const idle = loggerState.status === 'idle';
  React.useEffect(() => {
    if (!timelineExhausted || !idle) return;
    store.completeRun().catch(store.crash);
  }, [store, timelineExhausted, idle]);

  // Nothing else ends the run once the timeline is done, so the participant
  // would wait on the loading element forever.
  const { status } = loggerState;
  React.useEffect(() => {
    if (
      timelineExhausted &&
      (status === 'interrupted' || status === 'canceled')
    ) {
      store.crash(
        new Error(`The run was ${status} before the app could complete it.`),
      );
    }
  }, [store, timelineExhausted, status]);

  return (
    <TimelinePlayer
      timeline={timeline}
      elements={elements}
      paused={loggerState.status === 'paused'}
      // The run is saved until it is completed on the server. The run store
      // says when the timeline is exhausted, rather than the player: a player
      // remounted after that would otherwise show the completed element until
      // it reports the completion.
      loading={timelineExhausted && loggerState.status !== 'completed'}
      onLog={async (log) => {
        try {
          await logger.addLog(log);
        } catch (error) {
          // A log still held is recoverable: the paused slot handles it.
          if (logger.inFlightLogs.includes(log)) return;
          // Crashing the store here, rather than rejecting, hands the error
          // slot the rejection itself instead of the player's wrapper.
          store.crash(error);
        }
      }}
    />
  );
}
