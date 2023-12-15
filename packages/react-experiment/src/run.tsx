import * as React from 'react';
import { ReadonlyDeep } from 'type-fest';
import { RegisteredTask, Typed, RegisteredLog } from './config.js';
import { loggerContext, noLoggerSymbol, timelineContext } from './contexts.js';
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
  elements: Readonly<RunElements<Task>>;
  confirmBeforeUnload?: boolean;
} & UseRunParameter<Task, Log>;

// This component uses explicit return type to prevent the function from
// returning undefined, which could indicate a state isn't being handled.
export function Run<const T extends RegisteredTask>({
  elements,
  confirmBeforeUnload = true,
  ...useRunParameter
}: RunProps<T, RegisteredLog>): JSX.Element | null {
  const { onLog, ...state } = useRun(useRunParameter);
  useConfirmBeforeUnload(confirmBeforeUnload && state.status !== 'completed');

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
    default:
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      let _exhaustiveCheck: never = state;
      throw new Error('Unhandled timeline state');
  }
}

type UseRunParameter<Task extends { type: string }, Log> = {
  onCompleted?: () => void;
  onLog?: Logger<Log>;
  resumeAfter?: { type: Task['type']; number: number };
} & (
  | { timeline: ReadonlyDeep<Timeline<Task>>; loading?: boolean }
  | { timeline?: ReadonlyDeep<Timeline<Task>> | null; loading: true }
);
type RunState<Task, Log> = Exclude<TimelineState<Task>, { status: 'error' }> & {
  onLog: ((newLog: Log) => void) | null;
};
function useRun<const T extends { type: string }, L>({
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
