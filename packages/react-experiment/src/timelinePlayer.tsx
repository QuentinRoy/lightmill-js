import * as React from 'react';
import type { RegisteredLog, RegisteredTask, Typed } from './config.js';
import { loggerContext, noLoggerSymbol, taskContext } from './contexts.js';
import { LogDeliveryError } from './errors.js';
import {
  type AnyIteratorOrIterable,
  type TaskResult,
  usePlayerState,
} from './playerState.js';
import { type Logger, useLogWrapper } from './useLogWrapper.js';

export type TimelinePlayerElements<T extends Typed> = {
  tasks: Record<T['type'], React.ReactElement>;
  loading?: React.ReactElement;
  completed?: React.ReactElement;
  paused?: React.ReactElement;
};

type TimelinePlayerParameter<Task extends { type: string }, Log> = {
  onCompleted?: () => void;
  onLog?: Logger<Log>;
  /**
   * @deprecated Wrap the timeline with `resumeAfter` instead. This prop will
   * be removed in a future major version.
   */
  resumeAfterTask?: (task: Task) => boolean;
} & (
  | { timeline: AnyIteratorOrIterable<Task>; loading?: boolean }
  | { timeline?: AnyIteratorOrIterable<Task> | null; loading: true }
);

export type TimelinePlayerProps<Task extends Typed, Log> = {
  elements: TimelinePlayerElements<Task>;
  paused?: boolean;
} & TimelinePlayerParameter<Task, Log>;

/**
 * Runs a timeline, rendering `elements.tasks` for each task in turn.
 *
 * An iterator (a generator, a `resumeAfter` result...) is consumed once and
 * cannot be rewound, so it keeps its place when `TimelinePlayer` is remounted:
 * the task in progress is shown again, afresh. Anything else (an array, a Set)
 * starts over at each mount.
 */
// This component uses explicit return type to prevent the function from
// returning undefined, which could indicate a state isn't being handled.
export function TimelinePlayer<const T extends RegisteredTask>({
  elements,
  paused = false,
  onLog,
  loading = false,
  ...playerParameter
}: TimelinePlayerProps<T, RegisteredLog>): React.JSX.Element | null {
  const { onLog: logWrapper, error: logError } = useLogWrapper(onLog);
  const taskLogger = useTaskLogger(logWrapper, elements.tasks);
  const state = usePlayerState({ ...playerParameter, paused, loading });
  const taskValue = React.useMemo(
    () =>
      state.status === 'task'
        ? {
            task: state.task,
            completeTask: (result?: TaskResult) =>
              state.completeTask(result, logWrapper),
          }
        : null,
    [state, logWrapper],
  );
  if (logError != null) {
    throw logError;
  }
  if (paused && elements.paused == null) {
    throw new LogDeliveryError(
      'Logs could not be delivered. Provide elements.paused to <TimelinePlayer /> to handle this and avoid losing logs and progress, for example by offering to retry.',
    );
  }

  let element: React.ReactNode;
  switch (state.status) {
    case 'task': {
      let type: T['type'] = state.task.type;
      if (!(type in elements.tasks)) {
        throw new Error(`No task registered for type ${state.task.type}`);
      }
      element = (
        <taskContext.Provider key={state.taskKey} value={taskValue}>
          {elements.tasks[type]}
        </taskContext.Provider>
      );
      break;
    }
    case 'loading':
      element = elements.loading;
      break;
    case 'paused':
      element = elements.paused;
      break;
    case 'completed':
      if (elements.completed == null) return null;
      element = elements.completed;
      break;
    default: {
      let _exhaustiveCheck: never = state;
      throw new Error('Unhandled player state');
    }
  }
  return (
    <loggerContext.Provider value={taskLogger ?? noLoggerSymbol}>
      {element}
    </loggerContext.Provider>
  );
}

// The logger tasks get from useLogger. It refuses task types: their logs are
// completion logs, which only completeTask writes. Stable as long as logger
// is, like the logger itself.
function useTaskLogger(
  logger: ((log: RegisteredLog) => void) | null,
  tasks: Record<string, unknown>,
): ((log: RegisteredLog) => void) | null {
  const tasksRef = React.useRef(tasks);
  React.useInsertionEffect(() => {
    tasksRef.current = tasks;
  });
  return React.useMemo(() => {
    if (logger == null) return null;
    return (log: RegisteredLog) => {
      if (Object.hasOwn(tasksRef.current, log.type)) {
        throw new Error(
          `Cannot log type ${log.type}: it is a task type. A task's completion log is written by completeTask.`,
        );
      }
      logger(log);
    };
  }, [logger]);
}
