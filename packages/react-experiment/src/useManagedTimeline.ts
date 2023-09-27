import * as React from 'react';
import { Runner as TimelineRunner } from '@lightmill/runner';

export type TimelineStatus = 'running' | 'completed' | 'loading' | 'idle';

export type TimelineState<Task> =
  | { status: 'completed' }
  | { status: 'loading' }
  | { status: 'idle' }
  | { status: 'canceled' }
  | { status: 'error'; error: Error }
  | { status: 'running'; task: Task; onTaskCompleted: () => void };

export type AsyncTimeline<Task> = AsyncIterator<Task> | AsyncIterable<Task>;

export type SyncTimeline<Task> = Iterator<Task> | Iterable<Task>;

export type Timeline<Task> = AsyncTimeline<Task> | SyncTimeline<Task>;

type Options<Task> = {
  onTimelineCompleted?: () => void;
  onTimelineStarted?: () => void;
  onTaskStarted?: (task: Task) => void;
  onTaskCompleted?: (task: Task) => void;
  onTaskLoadingError?: (error: unknown) => void;
  timeline?: Timeline<Task> | null;
};

export default function useManagedTimeline<Task>(
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
        if (error instanceof Error) {
          setState({ status: 'error', error });
        } else {
          setState({ status: 'error', error: new Error(String(error)) });
        }
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
