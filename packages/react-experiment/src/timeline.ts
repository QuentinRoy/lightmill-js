import { run } from '@lightmill/runner';
import * as React from 'react';
import { BaseTask } from './config.js';

export type TimelineStatus = 'running' | 'completed' | 'loading' | 'idle';

export type TimelineState<Task extends BaseTask> =
  | { status: 'running'; task: Task; onTaskCompleted: () => void }
  | { status: 'completed'; task: null }
  | { status: 'loading'; task: null };

export type Timeline<Task extends BaseTask> =
  | Iterator<Task>
  | AsyncIterator<Task>
  | Iterable<Task>
  | AsyncIterable<Task>;

type TimelineAction<T> =
  | { type: 'task-completed' }
  | { type: 'task-started'; task: T; onTaskCompleted: () => void }
  | { type: 'experiment-completed' };

function timelineReducer<T extends BaseTask>(
  state: TimelineState<T>,
  action: TimelineAction<T>
): TimelineState<T> {
  switch (action.type) {
    case 'experiment-completed':
      return {
        status: 'completed',
        task: null,
      };
    case 'task-completed':
      return {
        status: 'loading',
        task: null,
      };
    case 'task-started':
      return {
        status: 'running',
        task: action.task,
        onTaskCompleted: action.onTaskCompleted,
      };
  }
}

export default function useManagedTimeline<Task extends BaseTask>(
  timeline: Timeline<Task>
): TimelineState<Task> {
  const [state, dispatch] = React.useReducer(timelineReducer<Task>, {
    status: 'loading',
    task: null,
  });
  React.useEffect(() => {
    let canceled = false;
    run({
      taskIterator: timeline,
      runTask(task) {
        return new Promise((resolve) => {
          dispatch({
            type: 'task-started',
            task,
            onTaskCompleted: () => {
              if (!canceled) {
                dispatch({ type: 'task-completed' });
                resolve();
              }
            },
          });
        });
      },
    }).then(() => {
      if (!canceled) {
        dispatch({ type: 'experiment-completed' });
      }
    });
    return () => {
      canceled = true;
    };
  }, [timeline]);

  return state;
}
