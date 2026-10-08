import * as React from 'react';
import type { RegisteredLog, RegisteredTask } from './config.js';
import { DefaultError } from './defaultError.js';
import { DefaultPaused } from './defaultPaused.js';
import { isLive, type RunClient, type RunLogger } from './logClient.js';
import type { PlayerStore } from './playerState.js';
import {
  getRunStore,
  isSameRun,
  type RunIdentity,
  type RunState,
  type RunStore,
  type RunStoreParams,
  type TimelineBuilder,
} from './runStore.js';
import { StorePlayer, type TimelinePlayerElements } from './timelinePlayer.js';
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
}: RunProps): React.JSX.Element {
  const store = useRunStore({
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
      content = (
        <ResumeProvider store={store} state={state}>
          {elements.resume ?? defaultResume}
        </ResumeProvider>
      );
      break;
    case 'error':
      content = (
        <ErrorProvider
          error={state.error}
          experimentName={experimentName}
          runName={runName}
        >
          {elements.error ?? defaultError}
        </ErrorProvider>
      );
      break;
    case 'ready':
      content = (
        // Another store is another run: its player starts afresh.
        <CrashBoundary key={store.id} onCrash={store.crash}>
          <RunPlayer
            store={store}
            logger={state.logger}
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
// and started again by the next render.
function useRunStore(params: RunStoreParams): RunStore {
  const ref = React.useRef<{ identity: RunIdentity; store: RunStore } | null>(
    null,
  );
  const identity = {
    client: params.client,
    experimentName: params.experimentName,
    runName: params.runName,
  };
  if (ref.current == null || !isSameRun(ref.current.identity, identity)) {
    ref.current = { identity, store: getRunStore(params) };
  }
  return ref.current.store;
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
  build,
  loading,
  elements,
}: {
  store: RunStore;
  logger: RunLogger;
  build: TimelineBuilder | null;
  loading: React.ReactElement;
  elements: RunElements;
}): React.JSX.Element {
  const playerStore = store.getPlayerStore(build);
  if (playerStore == null) return loading;
  return (
    <ReadyPlayer
      store={store}
      logger={logger}
      playerStore={playerStore}
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
  playerStore,
  elements,
}: {
  store: RunStore;
  logger: RunLogger;
  playerStore: PlayerStore<RegisteredTask>;
  elements: RunElements;
}): React.JSX.Element | null {
  const loggerState = React.useSyncExternalStore(
    logger.subscribe,
    () => logger.state,
  );
  const timelineCompleted = React.useSyncExternalStore(
    playerStore.subscribe,
    () => playerStore.getSnapshot().status === 'completed',
  );

  // Completing the run flushes the logger, which rejects while delivery is
  // paused. Waiting for idle avoids that rejection.
  const idle = loggerState.status === 'idle';
  React.useEffect(() => {
    if (!timelineCompleted || !idle) return;
    store.completeRun().catch(store.crash);
  }, [store, timelineCompleted, idle]);

  return (
    <StorePlayer
      store={playerStore}
      elements={elements}
      paused={loggerState.status === 'paused'}
      // The run is saved until it is completed on the server.
      loading={timelineCompleted && loggerState.status !== 'completed'}
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
