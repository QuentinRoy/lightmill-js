import * as React from 'react';
import type { RegisteredLog, RegisteredTask, Typed } from './config.js';
import { loggerContext, noLoggerSymbol, timelineContext } from './contexts.js';
import { LogDeliveryError } from './errors.js';
import useManagedTimeline, {
  type AnyIteratorOrIterable,
  type TimelineState,
} from './useManagedTimeline.js';

export type RunElements<T extends Typed> = {
  tasks: Record<T['type'], React.ReactElement>;
  loading?: React.ReactElement;
  completed?: React.ReactElement;
  paused?: React.ReactElement;
};

export type Logger<Log> = (log: Log) => Promise<void>;

export type RunProps<Task extends Typed, Log> = {
  elements: RunElements<Task>;
  confirmBeforeUnload?: boolean;
  paused?: boolean;
} & UseRunParameter<Task, Log>;

// This component uses explicit return type to prevent the function from
// returning undefined, which could indicate a state isn't being handled.
export function Run<const T extends RegisteredTask>({
  elements,
  confirmBeforeUnload = true,
  paused = false,
  ...useRunParameter
}: RunProps<T, RegisteredLog>): React.JSX.Element | null {
  const { onLog, ...state } = useRun(useRunParameter);
  const holdsRunningTask = useHoldsRunningTask(
    paused,
    state.status === 'running' ? state.onTaskCompleted : null,
  );
  // Paused logs are not delivered yet: leaving would lose them, even if the
  // timeline is completed.
  useConfirmBeforeUnload(
    confirmBeforeUnload && (paused || state.status !== 'completed'),
  );

  if (paused && elements.paused == null) {
    throw new LogDeliveryError(
      'Logs could not be delivered and the run is paused, but no elements.paused was provided to <Run />.',
    );
  }
  if (paused && !holdsRunningTask) {
    return (
      <loggerContext.Provider value={onLog ?? noLoggerSymbol}>
        {elements.paused}
      </loggerContext.Provider>
    );
  }

  switch (state.status) {
    case 'running': {
      let type: T['type'] = state.task.type;
      if (!(type in elements.tasks)) {
        throw new Error(`No task registered for type ${state.task.type}`);
      }
      return (
        <loggerContext.Provider value={onLog}>
          <timelineContext.Provider value={state}>
            {elements.tasks[type]}
          </timelineContext.Provider>
        </loggerContext.Provider>
      );
    }

    case 'completed':
      return elements.completed == null ? null : (
        <loggerContext.Provider value={onLog}>
          {elements.completed}
        </loggerContext.Provider>
      );

    // This may seem surprising to have canceled, idle, and loading in the same
    // case, but canceled is basically the same as idle, only a run was already
    // started and then stopped, e.g. because timeline changed.
    case 'idle':
    case 'canceled':
    case 'loading':
      return (
        <loggerContext.Provider value={onLog ?? noLoggerSymbol}>
          {elements.loading}
        </loggerContext.Provider>
      );
    default: {
      let _exhaustiveCheck: never = state;
      throw new Error('Unhandled timeline state');
    }
  }
}

// While paused, the task that was running when the pause began stays rendered
// (interrupting it would only lose what the participant is doing). Once the
// timeline moves on, elements.paused replaces whatever comes next. Tasks are
// identified by their onTaskCompleted, which is new for each task.
function useHoldsRunningTask(
  paused: boolean,
  runningTask: (() => void) | null,
): boolean {
  // Wrapped in an object because a function cannot be stored in state as is.
  const [pause, setPause] = React.useState<{
    heldTask: (() => void) | null;
  } | null>(null);
  // Adjusting state during render restarts it before anything is committed,
  // so the held task is the one rendered when paused turned true.
  if (paused && pause == null) {
    setPause({ heldTask: runningTask });
  } else if (!paused && pause != null) {
    setPause(null);
  }
  const heldTask = pause == null ? runningTask : pause.heldTask;
  return heldTask != null && heldTask === runningTask;
}

type UseRunParameter<Task extends { type: string }, Log> = {
  onCompleted?: () => void;
  onLog?: Logger<Log>;
  resumeAfter?: { type: Task['type']; number: number };
} & (
  | { timeline: AnyIteratorOrIterable<Task>; loading?: boolean }
  | { timeline?: AnyIteratorOrIterable<Task> | null; loading: true }
);
type RunState<Task, Log> = Exclude<TimelineState<Task>, { status: 'error' }> & {
  onLog: ((newLog: Log) => void) | null;
};
function useRun<T extends { type: string }, L>({
  onCompleted,
  timeline,
  resumeAfter,
  loading = false,
  onLog,
}: UseRunParameter<T, L>): RunState<T, L> {
  const { onLog: logWrapper, ...loggerState } = useLogWrapper(onLog);

  let timelineRef = React.useRef(timeline);
  // Prevent changes to timeline once set.
  React.useLayoutEffect(() => {
    const previousTimeline = timelineRef.current;
    if (previousTimeline != null && previousTimeline !== timeline) {
      throw new Error('Timeline cannot be changed once set');
    }
    timelineRef.current = timeline;
  }, [timeline]);

  const timelineState = useManagedTimeline({
    timeline: timeline,
    resumeAfter,
    onTimelineCompleted: onCompleted,
  });

  if (timelineState.status === 'error') {
    throw timelineState.error;
  }
  if (loggerState.status === 'error') {
    throw loggerState.error;
  }
  if (loading) {
    return { status: 'loading', onLog: logWrapper };
  } else if (timeline == null) {
    throw new Error('Timeline must be set when loading is false');
  }
  return { ...timelineState, onLog: logWrapper };
}

type LoggerState<L> =
  | { status: 'ok'; onLog: ((newLog: L) => void) | null }
  | { status: 'error'; error: Error; onLog: ((newLog: L) => void) | null };
function useLogWrapper<L>(onLog?: Logger<L>): LoggerState<L> {
  const logWrapper = React.useMemo(() => {
    if (onLog == null) return null;
    const thisLogger = onLog;
    return function logWrapper(newLog: L) {
      thisLogger(newLog).catch((error) => {
        let newError: Error =
          error instanceof Error
            ? new Error(`Could not add log : ${error.message}`, {
                cause: error,
              })
            : new Error('Could not add log');
        setLoggerState({ status: 'error', error: newError, onLog: logWrapper });
      });
    };
  }, [onLog]);

  const [loggerState, setLoggerState] = React.useState<LoggerState<L>>({
    status: 'ok',
    onLog: logWrapper,
  });

  return loggerState;
}

function useConfirmBeforeUnload(isEnabled: boolean) {
  React.useEffect(() => {
    if (isEnabled) {
      let handleBeforeUnload = (event: BeforeUnloadEvent) => {
        event.preventDefault();
        event.returnValue = '';
      };
      globalThis.addEventListener('beforeunload', handleBeforeUnload);
      return () => {
        globalThis.removeEventListener('beforeunload', handleBeforeUnload);
      };
    }
  }, [isEnabled]);
}
