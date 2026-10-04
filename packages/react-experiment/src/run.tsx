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
  paused?: boolean;
} & UseRunParameter<Task, Log>;

// This component uses explicit return type to prevent the function from
// returning undefined, which could indicate a state isn't being handled.
export function Run<const T extends RegisteredTask>({
  elements,
  paused = false,
  ...useRunParameter
}: RunProps<T, RegisteredLog>): React.JSX.Element | null {
  const { onLog, loading, ...state } = useRun(useRunParameter);
  const interrupted = paused || loading;
  const holdsRunningTask = useHoldsRunningTask(
    interrupted,
    state.status === 'running' ? state.taskKey : null,
  );

  if (paused && elements.paused == null) {
    throw new LogDeliveryError(
      'Logs could not be delivered. Provide elements.paused to <Run /> to handle this and avoid losing logs and progress, for example by offering to retry.',
    );
  }
  if (interrupted && !holdsRunningTask) {
    // paused wins over loading: it needs the participant's attention.
    return (
      <loggerContext.Provider value={onLog ?? noLoggerSymbol}>
        {paused ? elements.paused : elements.loading}
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

// While interrupted (paused or loading), the task that was running when the
// interruption began stays rendered (unmounting it would only lose what the
// participant is doing). Once the timeline moves on, elements.paused or
// elements.loading replaces whatever comes next.
function useHoldsRunningTask(
  interrupted: boolean,
  runningTaskKey: symbol | null,
): boolean {
  // null means not interrupted; heldTaskKey is null if no task was running when
  // the interruption began.
  const [pause, setPause] = React.useState<{
    heldTaskKey: symbol | null;
  } | null>(null);
  // React restarts the render right after a state update made during render,
  // before anything is committed, so the held task is the one that was
  // rendered when the interruption began.
  if (interrupted && pause == null) {
    setPause({ heldTaskKey: runningTaskKey });
  } else if (!interrupted && pause != null) {
    setPause(null);
  }
  const heldTaskKey = pause == null ? runningTaskKey : pause.heldTaskKey;
  return heldTaskKey != null && heldTaskKey === runningTaskKey;
}

type UseRunParameter<Task extends { type: string }, Log> = {
  onCompleted?: () => void;
  onLog?: Logger<Log>;
  resumeAfterTask?: (task: Task) => boolean;
} & (
  | { timeline: AnyIteratorOrIterable<Task>; loading?: boolean }
  | { timeline?: AnyIteratorOrIterable<Task> | null; loading: true }
);
type RunState<Task, Log> = Exclude<TimelineState<Task>, { status: 'error' }> & {
  onLog: ((newLog: Log) => void) | null;
  loading: boolean;
};
function useRun<T extends { type: string }, L>({
  onCompleted,
  timeline,
  resumeAfterTask,
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
    resumeAfterTask,
    onTimelineCompleted: onCompleted,
  });

  if (timelineState.status === 'error') {
    throw timelineState.error;
  }
  if (loggerState.status === 'error') {
    throw loggerState.error;
  }
  if (!loading && timeline == null) {
    throw new Error('Timeline must be set when loading is false');
  }
  return { ...timelineState, onLog: logWrapper, loading };
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
