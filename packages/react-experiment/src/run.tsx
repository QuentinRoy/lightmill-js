import * as React from 'react';
import type { RegisteredLog, RegisteredTask } from './config.js';
import { DefaultPaused } from './defaultPaused.js';
import type { RunClient, RunLogger } from './logClient.js';
import type { PlayerStore } from './playerState.js';
import {
  getRunStore,
  type RunState,
  type RunStore,
  type TimelineBuilder,
} from './runStore.js';
import { StorePlayer, type TimelinePlayerElements } from './timelinePlayer.js';
import { useConfirmBeforeUnload } from './useConfirmBeforeUnload.js';
import { LogDeliveryProvider } from './useLogDelivery.js';
import { resumeRunContext, useResumeRun } from './useResumeRun.js';

export type RunElements = TimelinePlayerElements<RegisteredTask> & {
  /** Asks the participant to resume an ongoing run. See `useResumeRun`. */
  resume?: React.ReactElement;
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
  switch (state.status) {
    case 'looking-up':
    case 'starting':
      return loading;
    case 'awaiting-confirmation':
      return (
        <ResumeProvider store={store} state={state}>
          {elements.resume ?? defaultResume}
        </ResumeProvider>
      );
    case 'error':
      throw state.error;
    case 'ready': {
      const playerStore = store.getPlayerStore(timeline);
      if (playerStore == null) return loading;
      return (
        <RunPlayer
          // Another store is another run: its player starts afresh.
          key={store.id}
          store={store}
          logger={state.logger}
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
    default: {
      const _exhaustiveCheck: never = state;
      throw new Error('Unhandled run state');
    }
  }
}

// The store of the current identity, kept for as long as the identity holds
// even if the store was evicted since: a finished run must not be looked up
// and started again by the next render.
function useRunStore(identity: Parameters<typeof getRunStore>[0]): RunStore {
  const ref = React.useRef<{
    client: RunClient;
    experimentName: string;
    runName: string;
    store: RunStore;
  } | null>(null);
  const { client, experimentName, runName } = identity;
  if (
    ref.current == null ||
    ref.current.client !== client ||
    ref.current.experimentName !== experimentName ||
    ref.current.runName !== runName
  ) {
    ref.current = {
      client,
      experimentName,
      runName,
      store: getRunStore(identity),
    };
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

function RunPlayer({
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
  const [completionFailure, setCompletionFailure] = React.useState<{
    error: unknown;
  } | null>(null);
  if (completionFailure != null) throw completionFailure.error;

  useConfirmBeforeUnload(
    loggerState.status === 'idle' ||
      loggerState.status === 'sending' ||
      loggerState.status === 'retrying' ||
      loggerState.status === 'paused',
  );

  // Completing the run flushes the logger, which rejects while delivery is
  // paused. Waiting for idle avoids that rejection.
  const idle = loggerState.status === 'idle';
  React.useEffect(() => {
    if (!timelineCompleted || !idle) return;
    store.completeRun().catch((error: unknown) => {
      setCompletionFailure({ error });
    });
  }, [store, timelineCompleted, idle]);

  return (
    <LogDeliveryProvider logger={logger}>
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
            if (!logger.inFlightLogs.includes(log)) throw error;
          }
        }}
      />
    </LogDeliveryProvider>
  );
}
