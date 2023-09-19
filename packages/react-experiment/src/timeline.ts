import * as React from 'react';
import { BaseTask } from './config.js';
import { Runner as TimelineRunner } from '@lightmill/runner';

export type TimelineStatus = 'running' | 'completed' | 'loading' | 'idle';

export type TimelineState<Task extends BaseTask> =
  | { status: 'completed' }
  | { status: 'loading' }
  | { status: 'idle' }
  | { status: 'canceled' }
  | { status: 'crashed'; error: unknown }
  | { status: 'running'; task: Task; onTaskCompleted: () => void };

export type AsyncTimeline<Task extends BaseTask> =
  | AsyncIterator<Task>
  | AsyncIterable<Task>;

export type SyncTimeline<Task extends BaseTask> =
  | Iterator<Task>
  | Iterable<Task>;

export type Timeline<Task extends BaseTask> =
  | AsyncTimeline<Task>
  | SyncTimeline<Task>;

type Options<Task extends BaseTask> = {
  onTimelineCompleted?: () => void;
  onTimelineStarted?: () => void;
  onTaskStarted?: (task: Task) => void;
  onTaskCompleted?: (task: Task) => void;
  onTaskLoadingError?: (error: unknown) => void;
  timeline: Timeline<Task> | null;
};

export default function useManagedTimeline<Task extends BaseTask>(
  options: Options<Task>,
): TimelineState<Task> {
  const [state, setState] = React.useState<TimelineState<Task>>({
    status: 'idle',
  });

  const callbacksRef = React.useRef(options);
  callbacksRef.current = options;

  React.useEffect(() => {
    if (options.timeline == null) return;
    const runner = new TimelineRunner<Task>({
      timeline: options.timeline,
      onTimelineStarted() {
        setState({ status: 'loading' });
        callbacksRef.current.onTimelineStarted?.();
      },
      onTaskStarted(task) {
        setState({
          status: 'running',
          task,
          onTaskCompleted() {
            runner.completeTask();
          },
        });
        callbacksRef.current.onTaskStarted?.(task);
      },
      onTaskCompleted(task) {
        setState({ status: 'loading' });
        callbacksRef.current.onTaskCompleted?.(task);
      },
      onTimelineCompleted() {
        setState({ status: 'completed' });
        callbacksRef.current.onTimelineCompleted?.();
      },
      onError(error) {
        setState({ status: 'crashed', error });
        callbacksRef.current.onTaskLoadingError?.(error);
      },
    });
    runner.start();
    return () => {
      if (runner.status !== 'completed') {
        runner.cancel();
      }
    };
  }, [options.timeline]);

  return state;
}
