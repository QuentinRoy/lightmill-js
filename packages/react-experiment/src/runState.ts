import {
  type MaybeAsyncIterator,
  Runner as TimelineRunner,
} from '@lightmill/runner';
import * as React from 'react';

export type AnyIteratorOrIterable<Task> =
  AsyncIterator<Task> | AsyncIterable<Task> | Iterator<Task> | Iterable<Task>;

export type RunTaskState<Task> = {
  status: 'task';
  task: Task;
  // Different for each started task, even if the timeline yields the same
  // task object twice.
  taskKey: symbol;
  onTaskCompleted: () => void;
};

export type RunState<Task> =
  | RunTaskState<Task>
  | { status: 'loading' }
  | { status: 'paused' }
  | { status: 'completed' };

type StoreSnapshot<Task> =
  | Exclude<RunState<Task>, { status: 'paused' }>
  | { status: 'error'; error: Error };

type RunStore<Task> = {
  timeline: AnyIteratorOrIterable<Task>;
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => StoreSnapshot<Task>;
  // Does nothing once started, so React can call it from every effect run.
  start: () => void;
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

// The timeline iterator is one-shot and the runner cannot be rewound, so the
// store lives as long as the timeline, not as long as an effect: unsubscribing
// (as StrictMode and <Activity> do) must not cancel it.
function createRunStore<Task>({
  timeline,
  resumeAfterTask,
  onCompleted,
}: {
  timeline: AnyIteratorOrIterable<Task>;
  resumeAfterTask?: (task: Task) => boolean;
  onCompleted: () => void;
}): RunStore<Task> {
  const listeners = new Set<() => void>();
  let snapshot: StoreSnapshot<Task> = { status: 'loading' };
  let started = false;
  const setSnapshot = (next: StoreSnapshot<Task>) => {
    snapshot = next;
    listeners.forEach((listener) => listener());
  };
  const runner = new TimelineRunner<Task>({
    timeline:
      resumeAfterTask == null
        ? timeline
        : skipThrough(timeline, resumeAfterTask),
    onLoading() {
      setSnapshot({ status: 'loading' });
    },
    onTaskStarted(task) {
      let hasBeenCompleted = false;
      setSnapshot({
        status: 'task',
        task,
        taskKey: Symbol('task'),
        onTaskCompleted() {
          if (hasBeenCompleted) throw new Error('Task already completed');
          runner.completeTask();
          hasBeenCompleted = true;
        },
      });
    },
    onTimelineCompleted() {
      setSnapshot({ status: 'completed' });
      onCompleted();
    },
    onError(error) {
      setSnapshot({
        status: 'error',
        error: error instanceof Error ? error : new Error(String(error)),
      });
    },
  });
  return {
    timeline,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    start() {
      if (started) return;
      started = true;
      runner.start();
    },
  };
}

const loadingSnapshot = { status: 'loading' } as const;
const noStore: RunStore<never> = {
  timeline: [],
  subscribe: () => () => {},
  getSnapshot: () => loadingSnapshot,
  start: () => {},
};

type UseRunStateOptions<Task> = {
  timeline?: AnyIteratorOrIterable<Task> | null;
  resumeAfterTask?: (task: Task) => boolean;
  onCompleted?: () => void;
  paused: boolean;
  loading: boolean;
};

/**
 * What `Run` has to render. While paused or loading, the task that was
 * running when the interruption began stays; once the timeline moves on,
 * paused or loading replaces whatever comes next.
 *
 * Throws timeline errors, and if no timeline is set while not loading.
 */
export function useRunState<Task>({
  timeline,
  resumeAfterTask,
  onCompleted,
  paused,
  loading,
}: UseRunStateOptions<Task>): RunState<Task> {
  const onCompletedRef = React.useRef(onCompleted);
  // Insertion effects run before the effect that starts the store.
  React.useInsertionEffect(() => {
    onCompletedRef.current = onCompleted;
  });

  const storeRef = React.useRef<RunStore<Task> | null>(null);
  if (storeRef.current == null) {
    if (timeline != null) {
      storeRef.current = createRunStore({
        timeline,
        resumeAfterTask,
        onCompleted: () => onCompletedRef.current?.(),
      });
    }
  } else if (storeRef.current.timeline !== timeline) {
    throw new Error('Timeline cannot be changed once set');
  }
  const store = storeRef.current ?? noStore;

  React.useEffect(() => {
    store.start();
  }, [store]);

  const snapshot = React.useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  if (snapshot.status === 'error') {
    throw snapshot.error;
  }

  const interrupted = paused || loading;
  const holdsRunningTask = useHoldsRunningTask(
    interrupted,
    snapshot.status === 'task' ? snapshot.taskKey : null,
  );

  if (!loading && timeline == null) {
    throw new Error('Timeline must be set when loading is false');
  }
  if (interrupted && !holdsRunningTask) {
    // paused wins over loading: it needs the participant's attention.
    return { status: paused ? 'paused' : 'loading' };
  }
  return snapshot;
}

function useHoldsRunningTask(
  interrupted: boolean,
  runningTaskKey: symbol | null,
): boolean {
  // null means not interrupted; heldTaskKey is null if no task was running when
  // the interruption began.
  const [pause, setPause] = React.useState<{
    heldTaskKey: symbol | null;
  } | null>(null);
  // React restarts the render right after a state update made during render,
  // before anything is committed, so the held task is the one that was
  // rendered when the interruption began.
  if (interrupted && pause == null) {
    setPause({ heldTaskKey: runningTaskKey });
  } else if (!interrupted && pause != null) {
    setPause(null);
  }
  const heldTaskKey = pause == null ? runningTaskKey : pause.heldTaskKey;
  return heldTaskKey != null && heldTaskKey === runningTaskKey;
}
