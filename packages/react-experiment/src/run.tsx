import * as React from 'react';
import { RegisteredTask, Typed, RegisteredLog } from './config.js';
import { loggerContext, timelineContext } from './contexts.js';
import useManagedTimeline, {
  Timeline,
  TimelineState,
} from './useManagedTimeline.js';

export type RunElements<T extends Typed> = {
  tasks: Record<T['type'], React.ReactElement>;
  loading?: React.ReactElement;
  completed?: React.ReactElement;
};

export type Logger<Log> = (log: Log) => Promise<void>;

export type RunProps<Task extends Typed, Log> = {
  elements: RunElements<Task>;
  confirmBeforeUnload?: boolean;
} & UseRunParameter<Task, Log>;

// This component uses explicit return type to prevent the function from
// returning undefined, which could indicate a state isn't being handled.
export function Run<T extends RegisteredTask>({
  elements,
  confirmBeforeUnload = true,
  ...useRunParameter
}: RunProps<T, RegisteredLog>): JSX.Element | null {
  const { log, ...state } = useRun(useRunParameter);
  useConfirmBeforeUnload(confirmBeforeUnload && state.status !== 'completed');

  switch (state.status) {
    case 'running': {
      let type: T['type'] = state.task.type;
      if (!(type in elements.tasks)) {
        throw new Error(`No task registered for type ${state.task.type}`);
      }
      return (
        <loggerContext.Provider value={log}>
          <timelineContext.Provider value={state}>
            {elements.tasks[type]}
          </timelineContext.Provider>
        </loggerContext.Provider>
      );
    }

    case 'completed':
      return elements.completed == null ? null : (
        <loggerContext.Provider value={log}>
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
        <loggerContext.Provider value={log}>
          {elements.loading}
        </loggerContext.Provider>
      );
    default:
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      let _exhaustiveCheck: never = state;
      throw new Error('Unhandled timeline state');
  }
}

type UseRunParameter<Task extends { type: string }, Log> = {
  onCompleted?: () => void;
  log?: Logger<Log>;
  resumeAfter?: { type: Task['type']; number: number };
} & (
  | { timeline: Timeline<Task>; loading?: boolean }
  | { timeline?: Timeline<Task> | null; loading: true }
);
type RunState<Task, Log> = Exclude<TimelineState<Task>, { status: 'error' }> & {
  log: ((newLog: Log) => void) | null;
};
function useRun<T extends { type: string }, L>({
  onCompleted,
  timeline,
  resumeAfter,
  loading = false,
  log,
}: UseRunParameter<T, L>): RunState<T, L> {
  const { log: logWrapper, ...loggerState } = useLogWrapper(log);

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
    return { status: 'loading', log: logWrapper };
  } else if (timeline == null) {
    throw new Error('Timeline must be set when loading is false');
  }
  return { ...timelineState, log: logWrapper };
}

type LoggerState = { status: 'ok' } | { status: 'error'; error: Error };
function useLogWrapper<L>(log?: Logger<L>): LoggerState & {
  log: ((newLog: L) => void) | null;
} {
  const [loggerState, setLoggerState] = React.useState<LoggerState>({
    status: 'ok',
  });

  const logWrapper = React.useMemo(() => {
    if (log == null) return null;
    const thisLogger = log;
    return function logWrapper(newLog: L) {
      thisLogger(newLog).catch((error) => {
        if (error instanceof Error) {
          let newError = new Error(`Could not add log : ${error.message}`);
          newError.stack = error.stack;
          setLoggerState({ status: 'error', error: newError });
        } else {
          let newError = new Error('Could not add log');
          setLoggerState({ status: 'error', error: newError });
        }
      });
    };
  }, [log]);
  return { ...loggerState, log: logWrapper };
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
