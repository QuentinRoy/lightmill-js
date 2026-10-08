import * as React from 'react';
import type { RegisteredLog, RegisteredTask, Typed } from './config.js';
import { loggerContext, noLoggerSymbol, taskContext } from './contexts.js';
import { LogDeliveryError } from './errors.js';
import {
  type AnyIteratorOrIterable,
  type PlayerStore,
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
 * The timeline is consumed once and cannot be rewound: remounting
 * `TimelinePlayer` (outside of StrictMode) needs a fresh timeline.
 */
// This component uses explicit return type to prevent the function from
// returning undefined, which could indicate a state isn't being handled.
export function TimelinePlayer<const T extends RegisteredTask>(
  props: TimelinePlayerProps<T, RegisteredLog>,
): React.JSX.Element | null {
  return usePlayerElement(props);
}

/**
 * `TimelinePlayer` for a timeline that lives in a store created elsewhere.
 * The package does not export it: `Run` is its only user.
 */
export function StorePlayer<const T extends RegisteredTask>({
  store,
  ...props
}: {
  store: PlayerStore<T>;
  elements: TimelinePlayerElements<T>;
  paused?: boolean;
  loading?: boolean;
  onLog?: Logger<RegisteredLog>;
  onCompleted?: () => void;
}): React.JSX.Element | null {
  return usePlayerElement({ ...props, store });
}

function usePlayerElement<const T extends RegisteredTask>({
  elements,
  paused = false,
  onLog,
  loading = false,
  ...playerParameter
}: {
  elements: TimelinePlayerElements<T>;
  paused?: boolean;
  loading?: boolean;
  onLog?: Logger<RegisteredLog>;
  onCompleted?: () => void;
  timeline?: AnyIteratorOrIterable<T> | null;
  store?: PlayerStore<T>;
}): React.JSX.Element | null {
  const { onLog: logWrapper, error: logError } = useLogWrapper(onLog);
  const state = usePlayerState({ ...playerParameter, paused, loading });
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
        <taskContext.Provider key={state.taskKey} value={state}>
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
    <loggerContext.Provider value={logWrapper ?? noLoggerSymbol}>
      {element}
    </loggerContext.Provider>
  );
}
