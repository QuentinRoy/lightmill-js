import { Runner as TimelineRunner } from '@lightmill/runner';
import * as React from 'react';

export type TimelineStatus = 'running' | 'completed' | 'loading' | 'idle';

export type TimelineState<Task> =
  | { status: 'completed' }
  | { status: 'loading' }
  | { status: 'idle' }
  | { status: 'canceled' }
  | { status: 'error'; error: Error }
  | { status: 'running'; task: Task; onTaskCompleted: () => void };

export type AnyIteratorOrIterable<Task> =
  | AsyncIterator<Task>
  | AsyncIterable<Task>
  | Iterator<Task>
  | Iterable<Task>;

type Options<Task extends { type: string }> = {
  onTimelineCompleted?: () => void;
  onTimelineStarted?: () => void;
  onTaskStarted?: (task: Task) => void;
  onTaskCompleted?: (task: Task) => void;
  onTaskLoadingError?: (error: unknown) => void;
  timeline?: AnyIteratorOrIterable<Task> | null;
  resumeAfter?: { type: Task['type']; number: number };
};

export default function useManagedTimeline<Task extends { type: string }>(
  options: Options<Task>,
): TimelineState<Task> {
  const [state, setState] = React.useState<TimelineState<Task>>({
    status: 'idle',
  });

  const optionsRef = React.useRef(options);
  optionsRef.current = options;

  React.useEffect(() => {
    if (options.timeline == null) return;
    let resumeTaskFound = optionsRef.current.resumeAfter == null;
    let resumeTaskTypeCount = 0;
    const runner = new TimelineRunner<Task>({
      timeline: options.timeline,
      onTimelineStarted() {
        setState({ status: 'loading' });
        optionsRef.current.onTimelineStarted?.();
      },
      onTaskStarted(task) {
        if (!resumeTaskFound) {
          runner.completeTask();
          return;
        }
        let hasBeenCompleted = false;
        setState({
          status: 'running',
          task,
          onTaskCompleted() {
            if (hasBeenCompleted) throw new Error('Task already completed');
            runner.completeTask();
            hasBeenCompleted = true;
          },
        });
        optionsRef.current.onTaskStarted?.(task);
      },
      onTaskCompleted(task) {
        if (resumeTaskFound) {
          setState({ status: 'loading' });
          optionsRef.current.onTaskCompleted?.(task);
          return;
        }
        if (task.type === optionsRef.current.resumeAfter?.type) {
          resumeTaskTypeCount++;
        }
        if (resumeTaskTypeCount === optionsRef.current.resumeAfter?.number) {
          resumeTaskFound = true;
        }
      },
      onTimelineCompleted() {
        if (!resumeTaskFound) {
          setState({
            status: 'error',
            error: new Error('Could not find task to resume after'),
          });
          return;
        }
        setState({ status: 'completed' });
        optionsRef.current.onTimelineCompleted?.();
      },
      onError(error) {
        if (error instanceof Error) {
          setState({ status: 'error', error });
        } else {
          setState({ status: 'error', error: new Error(String(error)) });
        }
        optionsRef.current.onTaskLoadingError?.(error);
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
