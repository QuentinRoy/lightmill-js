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
  const logger = onLog ?? noLoggerSymbol;
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
      <loggerContext.Provider value={logger}>
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
        <loggerContext.Provider value={logger}>
          <timelineContext.Provider value={state}>
            {elements.tasks[type]}
          </timelineContext.Provider>
        </loggerContext.Provider>
      );
    }

    case 'completed':
      return elements.completed == null ? null : (
        <loggerContext.Provider value={logger}>
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
        <loggerContext.Provider value={logger}>
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
  const { onLog: logWrapper, error: logError } = useLogWrapper(onLog);

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
  if (logError != null) {
    throw logError;
  }
  if (!loading && timeline == null) {
    throw new Error('Timeline must be set when loading is false');
  }
  return { ...timelineState, onLog: logWrapper, loading };
}

function useLogWrapper<L>(onLog?: Logger<L>): {
  onLog: ((newLog: L) => void) | null;
  error: Error | null;
} {
  const onLogRef = React.useRef(onLog);
  // Insertion effects run before layout effects, so a task logging from a
  // layout effect in the commit that changes onLog reaches the new one.
  React.useInsertionEffect(() => {
    onLogRef.current = onLog;
  });
  const [error, setError] = React.useState<Error | null>(null);
  // Stable for the lifetime of Run, so effects depending on the logger do not
  // rerun whenever onLog changes, such as when it is an inline arrow.
  const logWrapper = React.useCallback((newLog: L) => {
    const currentOnLog = onLogRef.current;
    if (currentOnLog == null) {
      setError(
        new LogDeliveryError(
          'Could not add log: onLog was removed from <Run />',
          { log: newLog },
        ),
      );
      return;
    }
    currentOnLog(newLog).catch((cause) => {
      setError(
        new LogDeliveryError(
          cause instanceof Error
            ? `Could not add log : ${cause.message}`
            : 'Could not add log',
          { cause, log: newLog },
        ),
      );
    });
  }, []);
  return { onLog: onLog == null ? null : logWrapper, error };
}
