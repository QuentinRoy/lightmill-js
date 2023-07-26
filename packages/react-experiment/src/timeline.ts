import { run } from '@lightmill/runner';
import * as React from 'react';
import { BaseTask, RegisteredLog } from './config.js';

export type TimelineStatus = 'running' | 'completed' | 'loading' | 'idle';

export type TimelineState<Task extends BaseTask> =
  | { status: 'completed'; task: null }
  | { status: 'loading'; task: null }
  | { status: 'idle'; task: null }
  | { status: 'canceled'; task: null }
  | { status: 'running'; task: Task; onTaskCompleted: () => void }
  | { status: 'crashed'; task: null; error: Error };

export type Timeline<Task extends BaseTask> =
  | Iterator<Task>
  | AsyncIterator<Task>
  | Iterable<Task>
  | AsyncIterable<Task>;

type TimelineAction<T> =
  | { type: 'logger-connecting' }
  | { type: 'run-started' }
  | { type: 'task-started'; task: T; onTaskCompleted: () => void }
  | { type: 'task-completed' }
  | { type: 'all-tasks-completed' }
  | { type: 'run-canceled' }
  | { type: 'run-completed' }
  | { type: 'logger-error'; error: Error };

export type Logger = {
  startRun(): Promise<void>;
  addLog(log: RegisteredLog): Promise<void>;
  completeRun(): Promise<void>;
  cancelRun?(): Promise<void>;
};

function timelineReducer<T extends BaseTask>(
  state: TimelineState<T>,
  action: TimelineAction<T>,
): TimelineState<T> {
  switch (action.type) {
    case 'run-started':
    case 'logger-connecting':
      return { status: 'loading', task: null };
    case 'task-started':
      return {
        status: 'running',
        task: action.task,
        onTaskCompleted: action.onTaskCompleted,
      };
    case 'task-completed':
    case 'all-tasks-completed':
      return { status: 'loading', task: null };
    case 'run-canceled':
      return { status: 'canceled', task: null };
    case 'run-completed':
      return { status: 'completed', task: null };
    case 'logger-error':
      return { status: 'crashed', task: null, error: action.error };
  }
}

export default function useManagedTimeline<Task extends BaseTask>(
  timeline: Timeline<Task> | null,
  logger: Logger | null,
  {
    cancelRunOnUnload,
    completeRunOnCompletion,
  }: { cancelRunOnUnload: boolean; completeRunOnCompletion: boolean },
): TimelineState<Task> {
  const [state, dispatch] = React.useReducer(timelineReducer<Task>, {
    status: 'idle',
    task: null,
  });

  // When the page is closed, one may want to mark the run as canceled.
  React.useEffect(() => {
    if (!cancelRunOnUnload) return;
    let unloadHandler = () => {
      logger?.cancelRun?.();
    };
    globalThis.addEventListener('unload', unloadHandler);
    return () => {
      globalThis.removeEventListener('unload', unloadHandler);
    };
  }, [cancelRunOnUnload, logger]);

  React.useEffect(() => {
    let hasEnded = false;
    async function doRun() {
      if (!timeline) return;
      if (logger != null) {
        dispatch({ type: 'logger-connecting' });
        await cachedLoggerStartRun(logger).catch((error) => {
          if (hasEnded) return;
          dispatch({ type: 'logger-error', error });
          hasEnded = true;
        });
      }
      // Every time we await, we need to check if the timeline has ended during
      // the await.
      if (hasEnded) return;
      await run({
        taskIterator: timeline,
        runTask(task) {
          return new Promise((resolve) => {
            let onTaskCompleted = () => {
              if (hasEnded) return;
              dispatch({ type: 'task-completed' });
              resolve();
            };
            dispatch({ type: 'task-started', task, onTaskCompleted });
          });
        },
      });
      if (hasEnded) return;
      dispatch({ type: 'all-tasks-completed' });
      await logger?.completeRun();
      if (hasEnded) return;
      dispatch({ type: 'run-completed' });
      hasEnded = true;
    }
    doRun();
    return () => {
      if (!hasEnded) {
        // Note: it might be tempting to call `logger.cancelRun()` here, but
        // that's not a good idea. The run might be resuming in the future.
        // This is especially true in development, where the Run component
        // is often unmounted and remounted.
        dispatch({ type: 'run-canceled' });
      }
      hasEnded = true;
    };
  }, [logger, timeline]);

  return state;
}

// It is important to cache the start of the logger because we don't want to
// start the same run multiple times, which would be refused by the log server.
// This is especially important in development, where the Run component is
// often unmounted and remounted.
const cachedLoggerStarts = new WeakMap<Logger, Promise<void>>();
function cachedLoggerStartRun(logger: Logger) {
  let cachedStart = cachedLoggerStarts.get(logger);
  if (cachedStart == null) {
    cachedStart = logger.startRun();
    cachedLoggerStarts.set(logger, cachedStart);
  }
  return cachedStart;
}
