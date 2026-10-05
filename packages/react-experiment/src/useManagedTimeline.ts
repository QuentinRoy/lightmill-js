import {
  type MaybeAsyncIterator,
  Runner as TimelineRunner,
} from '@lightmill/runner';
import * as React from 'react';

export type TimelineStatus = 'running' | 'completed' | 'loading' | 'idle';

export type TimelineState<Task> =
  | { status: 'completed' }
  | { status: 'loading' }
  | { status: 'idle' }
  | { status: 'canceled' }
  | { status: 'error'; error: Error }
  | {
      status: 'running';
      task: Task;
      // Different for each started task, even if the timeline yields the same
      // task object twice.
      taskKey: symbol;
      onTaskCompleted: () => void;
    };

export type AnyIteratorOrIterable<Task> =
  AsyncIterator<Task> | AsyncIterable<Task> | Iterator<Task> | Iterable<Task>;

type Options<Task extends { type: string }> = {
  onTimelineCompleted?: () => void;
  onTimelineStarted?: () => void;
  onTaskStarted?: (task: Task) => void;
  onTaskCompleted?: (task: Task) => void;
  onTaskLoadingError?: (error: unknown) => void;
  timeline?: AnyIteratorOrIterable<Task> | null;
  resumeAfterTask?: (task: Task) => boolean;
};

// Skips every task up to and including the first one matching resumeAfterTask.
// It stays synchronous for as long as the timeline is, so resuming a
// synchronous timeline never shows the loading state. Skipping in a loop
// rather than completing each task from the runner's onTaskStarted also
// avoids a recursion that overflows the stack on long timelines.
function skipThrough<Task>(
  timeline: AnyIteratorOrIterable<Task>,
  resumeAfterTask: (task: Task) => boolean,
): MaybeAsyncIterator<Task> {
  const iterator: MaybeAsyncIterator<Task> =
    Symbol.iterator in timeline
      ? timeline[Symbol.iterator]()
      : Symbol.asyncIterator in timeline
        ? timeline[Symbol.asyncIterator]()
        : timeline;
  let skipped = false;
  const skip = (
    result: IteratorResult<Task>,
  ): IteratorResult<Task> | Promise<IteratorResult<Task>> => {
    while (!result.done) {
      if (resumeAfterTask(result.value)) {
        skipped = true;
        return iterator.next();
      }
      const next = iterator.next();
      if ('then' in next) return next.then(skip);
      result = next;
    }
    throw new Error('No task matched resumeAfterTask');
  };
  return {
    next() {
      if (skipped) return iterator.next();
      const first = iterator.next();
      return 'then' in first ? first.then(skip) : skip(first);
    },
  };
}

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
    const { resumeAfterTask } = optionsRef.current;
    const runner = new TimelineRunner<Task>({
      timeline:
        resumeAfterTask == null
          ? options.timeline
          : skipThrough(options.timeline, resumeAfterTask),
      onTimelineStarted() {
        setState({ status: 'loading' });
        optionsRef.current.onTimelineStarted?.();
      },
      onTaskStarted(task) {
        let hasBeenCompleted = false;
        setState({
          status: 'running',
          task,
          taskKey: Symbol('task'),
          onTaskCompleted() {
            if (hasBeenCompleted) throw new Error('Task already completed');
            runner.completeTask();
            hasBeenCompleted = true;
          },
        });
        optionsRef.current.onTaskStarted?.(task);
      },
      onTaskCompleted(task) {
        setState({ status: 'loading' });
        optionsRef.current.onTaskCompleted?.(task);
      },
      onTimelineCompleted() {
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
