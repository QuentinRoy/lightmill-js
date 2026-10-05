import * as React from 'react';
import type { RegisteredLog, RegisteredTask, Typed } from './config.js';
import { loggerContext, noLoggerSymbol, taskContext } from './contexts.js';
import { LogDeliveryError } from './errors.js';
import { type AnyIteratorOrIterable, useRunState } from './runState.js';

export type RunElements<T extends Typed> = {
  tasks: Record<T['type'], React.ReactElement>;
  loading?: React.ReactElement;
  completed?: React.ReactElement;
  paused?: React.ReactElement;
};

export type Logger<Log> = (log: Log) => Promise<void>;

type RunParameter<Task extends { type: string }, Log> = {
  onCompleted?: () => void;
  onLog?: Logger<Log>;
  resumeAfterTask?: (task: Task) => boolean;
} & (
  | { timeline: AnyIteratorOrIterable<Task>; loading?: boolean }
  | { timeline?: AnyIteratorOrIterable<Task> | null; loading: true }
);

export type RunProps<Task extends Typed, Log> = {
  elements: RunElements<Task>;
  paused?: boolean;
} & RunParameter<Task, Log>;

/**
 * Runs a timeline, rendering `elements.tasks` for each task in turn.
 *
 * The timeline is consumed once and cannot be rewound: remounting `Run`
 * (outside of StrictMode) needs a fresh timeline.
 */
// This component uses explicit return type to prevent the function from
// returning undefined, which could indicate a state isn't being handled.
export function Run<const T extends RegisteredTask>({
  elements,
  paused = false,
  onLog,
  loading = false,
  ...runParameter
}: RunProps<T, RegisteredLog>): React.JSX.Element | null {
  const { onLog: logWrapper, error: logError } = useLogWrapper(onLog);
  const state = useRunState({ ...runParameter, paused, loading });
  if (logError != null) {
    throw logError;
  }
  if (paused && elements.paused == null) {
    throw new LogDeliveryError(
      'Logs could not be delivered. Provide elements.paused to <Run /> to handle this and avoid losing logs and progress, for example by offering to retry.',
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
        <taskContext.Provider value={state}>
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
      throw new Error('Unhandled run state');
    }
  }
  return (
    <loggerContext.Provider value={logWrapper ?? noLoggerSymbol}>
      {element}
    </loggerContext.Provider>
  );
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
