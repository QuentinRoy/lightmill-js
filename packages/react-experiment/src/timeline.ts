import { run } from '@lightmill/runner';
import * as React from 'react';
import { BaseTask, RegisteredLog } from './config.js';

export type TimelineStatus = 'running' | 'completed' | 'loading' | 'idle';

export type TimelineState<Task extends BaseTask> =
  | { status: 'completed'; task: null }
  | { status: 'loading'; task: null }
  | { status: 'idle'; task: null }
  | { status: 'canceled'; task: null }
  | { status: 'running'; task: Task; onTaskCompleted: () => void };

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
  | { type: 'run-completed' }
  | { type: 'run-canceled' }
  | { type: 'logger-flushed' };

export type Logger = {
  startRun(): Promise<void>;
  addLog(log: RegisteredLog): Promise<void>;
  flush(): Promise<void>;
  completeRun(): Promise<void>;
  cancelRun?(): Promise<void>;
};

function timelineReducer<T extends BaseTask>(
  state: TimelineState<T>,
  action: TimelineAction<T>
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
      return { status: 'loading', task: null };
    case 'run-completed':
      return { status: 'loading', task: null };
    case 'run-canceled':
      return { status: 'canceled', task: null };
    case 'logger-flushed':
      return { status: 'completed', task: null };
  }
}

export default function useManagedTimeline<Task extends BaseTask>(
  timeline: Timeline<Task> | null,
  logger: Logger | null
): TimelineState<Task> {
  const [state, dispatch] = React.useReducer(timelineReducer<Task>, {
    status: 'idle',
    task: null,
  });
  React.useEffect(() => {
    const loggerStartRun = getCachedLoggerStartRun(logger);
    if (!timeline) return;
    let hasEnded = false;
    dispatch({ type: 'logger-connecting' });
    Promise.resolve()
      .then(() => loggerStartRun())
      .then(() => {
        if (hasEnded) return;
        dispatch({ type: 'run-started' });
        return run({
          taskIterator: timeline,
          runTask(task) {
            return new Promise((resolve) => {
              dispatch({
                type: 'task-started',
                task,
                onTaskCompleted: () => {
                  if (hasEnded) return;
                  dispatch({ type: 'task-completed' });
                  resolve();
                },
              });
            });
          },
        });
      })
      .then(() => {
        if (hasEnded) return;
        dispatch({ type: 'run-completed' });
        return logger?.flush();
      })
      .then(() => {
        if (hasEnded) return;
        dispatch({ type: 'logger-flushed' });
        hasEnded = true;
      });
    return () => {
      if (!hasEnded) {
        logger?.cancelRun?.();
        dispatch({ type: 'run-canceled' });
      }
      hasEnded = true;
    };
  }, [logger, timeline]);

  return state;
}

const cachedLoggerStarts = new WeakMap<Logger, Promise<void>>();
function getCachedLoggerStartRun(logger: Logger | null) {
  return () => {
    if (logger == null) return;
    let cachedStart = cachedLoggerStarts.get(logger);
    if (cachedStart == null) {
      cachedStart = logger.startRun();
      cachedLoggerStarts.set(logger, cachedStart);
    }
    return cachedStart;
  };
}
