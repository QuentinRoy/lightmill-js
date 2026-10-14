import {
  type MaybeAsyncIterator,
  resumeAfter,
  TimelineRunner,
} from '@lightmill/runner';
import * as React from 'react';
import { reservedKeys, type TaskId, type Typed } from './config.js';
import { TimelineMismatchError } from './errors.js';
import { noSubscribe } from './utils.js';

// What a task passes to completeTask, and the timeline receives from next().
export type TaskResult = Record<string, unknown>;

// The timeline receives undefined from the first next() call only.
export type TimelineNext = TaskResult | undefined;

// MaybeAsyncIterator is what resumeAfter returns.
export type AnyIteratorOrIterable<Task> =
  | AsyncIterator<Task, unknown, TimelineNext>
  | AsyncIterable<Task, unknown, TimelineNext>
  | Iterator<Task, unknown, TimelineNext>
  | Iterable<Task, unknown, TimelineNext>
  | MaybeAsyncIterator<Task, TimelineNext>;

type CompletionLog = TaskResult & { type: string; taskId: TaskId };

const idRule =
  'Every task needs an id, a string or a number unique within the timeline.';

/** Throws if `task` has no valid id. */
export function taskIdOf(task: Typed): TaskId {
  const id: unknown = 'id' in task ? task.id : undefined;
  if (id == null) {
    throw new Error(`A task of type ${task.type} has no id. ${idRule}`);
  }
  // Replay compares ids with ===, and completion logs go through JSON.
  if (typeof id !== 'string' && typeof id !== 'number') {
    throw new Error(
      `The id of a task of type ${task.type} is neither a string nor a number. ${idRule}`,
    );
  }
  return id;
}

/**
 * Ids a timeline used before a player got it, such as those of the tasks a
 * replay stepped through. Its tasks cannot use them again.
 */
export const usedTaskIds = new WeakMap<object, Iterable<TaskId>>();

export type PlayerTaskState<Task> = {
  status: 'task';
  task: Task;
  // Different for each started task, even if the timeline yields the same
  // task object twice. Used as the React key so each task mounts fresh.
  taskKey: number;
  /**
   * Completes the task. `log` receives its completion log first, so a result
   * that cannot be logged leaves the task incomplete.
   */
  completeTask: (
    result: TaskResult | undefined,
    log: ((completionLog: CompletionLog) => void) | null,
  ) => void;
};

export type PlayerState<Task> =
  | PlayerTaskState<Task>
  | { status: 'loading' }
  | { status: 'paused' }
  | { status: 'completed' };

type StoreSnapshot<Task> =
  | Exclude<PlayerState<Task>, { status: 'paused' }>
  | { status: 'error'; error: Error };

type PlayerStore<Task> = {
  timeline: AnyIteratorOrIterable<Task>;
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => StoreSnapshot<Task>;
  // Does nothing once started, so React can call it from every effect run.
  start: () => void;
};

const loadingSnapshot = { status: 'loading' } as const;

// The timeline iterator is one-shot and the runner cannot be rewound, so the
// store lives as long as the timeline, not as long as an effect: unsubscribing
// (as StrictMode and <Activity> do) must not cancel it.
function createPlayerStore<Task extends Typed>({
  timeline,
  resumeAfterTask,
}: {
  timeline: AnyIteratorOrIterable<Task>;
  resumeAfterTask?: (task: Task) => boolean;
}): PlayerStore<Task> {
  const listeners = new Set<() => void>();
  let snapshot: StoreSnapshot<Task> = loadingSnapshot;
  let started = false;
  let taskCount = 0;
  const taskIds = new Set(usedTaskIds.get(timeline));
  const setSnapshot = (next: StoreSnapshot<Task>) => {
    snapshot = next;
    listeners.forEach((listener) => listener());
  };
  const runner = new TimelineRunner<Task, TimelineNext>({
    timeline:
      resumeAfterTask == null
        ? timeline
        : resumeAfter(timeline, resumeAfterTask),
    onLoading() {
      setSnapshot({ status: 'loading' });
    },
    onTaskStarted(task) {
      let taskId: TaskId;
      try {
        // Completion logs tell tasks apart by id.
        taskId = taskIdOf(task);
      } catch (error) {
        setSnapshot({ status: 'error', error: toError(error) });
        return;
      }
      if (taskIds.has(taskId)) {
        setSnapshot({
          status: 'error',
          error: new TimelineMismatchError(
            `Task id ${taskId} is already used. ${idRule}`,
          ),
        });
        return;
      }
      taskIds.add(taskId);
      let hasBeenCompleted = false;
      const taskKey = taskCount++;
      setSnapshot({
        status: 'task',
        task,
        taskKey,
        completeTask(result, log) {
          if (hasBeenCompleted) throw new Error('Task already completed');
          const reserved = reservedKeys.filter(
            (key) => result != null && Object.hasOwn(result, key),
          );
          if (reserved.length > 0) {
            throw new TypeError(
              `A task result cannot hold ${reserved.join(', ')}: these keys are reserved for its completion log`,
            );
          }
          log?.({ ...result, type: task.type, taskId });
          hasBeenCompleted = true;
          // A replay reads the result back from the completion log, where no
          // result is an empty one.
          runner.completeTask(result ?? {});
        },
      });
    },
    onTimelineCompleted() {
      setSnapshot({ status: 'completed' });
    },
    onError(error) {
      setSnapshot({ status: 'error', error: toError(error) });
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

function toError(error: unknown): Error {
  return error instanceof Error
    ? error
    : new Error(String(error), { cause: error });
}

// Stores of iterators, which a new runner could not read from the start: a
// remounted player picks up the store where the previous one left it. Anything
// else can be iterated again, so each mount builds its own.
const iteratorStores = new WeakMap<object, PlayerStore<unknown>>();

function getPlayerStore<Task extends Typed>({
  timeline,
  resumeAfterTask,
}: {
  timeline: AnyIteratorOrIterable<Task>;
  resumeAfterTask?: (task: Task) => boolean;
}): PlayerStore<Task> {
  if (
    typeof timeline !== 'object' ||
    !('next' in timeline) ||
    typeof timeline.next !== 'function'
  ) {
    return createPlayerStore({ timeline, resumeAfterTask });
  }
  const cached = iteratorStores.get(timeline);
  // A timeline is a single object of a single task type, so the store found
  // under it has the Task type it was created with.
  if (cached != null) return cached as PlayerStore<Task>;
  const store = createPlayerStore({ timeline, resumeAfterTask });
  iteratorStores.set(timeline, store);
  return store;
}

const getLoadingSnapshot = () => loadingSnapshot;

type UsePlayerStateOptions<Task extends Typed> = {
  timeline?: AnyIteratorOrIterable<Task> | null;
  resumeAfterTask?: (task: Task) => boolean;
  onCompleted?: () => void;
  paused: boolean;
  loading: boolean;
};

/**
 * What `TimelinePlayer` has to render. While paused or loading, the task that
 * was running when the interruption began stays; once the timeline moves on,
 * paused or loading replaces whatever comes next.
 *
 * Throws timeline errors, and if no timeline is set while not loading.
 */
export function usePlayerState<Task extends Typed>({
  timeline,
  resumeAfterTask,
  onCompleted,
  paused,
  loading,
}: UsePlayerStateOptions<Task>): PlayerState<Task> {
  const onCompletedRef = React.useRef(onCompleted);
  // Insertion effects run before the effects that start the store and report
  // its completion.
  React.useInsertionEffect(() => {
    onCompletedRef.current = onCompleted;
  });

  const storeRef = React.useRef<PlayerStore<Task> | null>(null);
  if (storeRef.current == null) {
    if (timeline != null) {
      storeRef.current = getPlayerStore({ timeline, resumeAfterTask });
    }
  } else if (storeRef.current.timeline !== timeline) {
    throw new Error('Timeline cannot be changed once set');
  }
  const store = storeRef.current;

  React.useEffect(() => {
    store?.start();
  }, [store]);

  // Until a timeline is set, the player is loading.
  const snapshot = React.useSyncExternalStore(
    store?.subscribe ?? noSubscribe,
    store?.getSnapshot ?? getLoadingSnapshot,
    store?.getSnapshot ?? getLoadingSnapshot,
  );
  if (snapshot.status === 'error') {
    throw snapshot.error;
  }

  // onCompleted is called from an effect because effects only run while the
  // component is mounted and visible. It is therefore never called after an
  // unmount, and a completion that happens while <Activity> hides the component
  // is reported once it is shown again. The ref keeps StrictMode's effect rerun
  // from calling it twice.
  const completedNotifiedRef = React.useRef(false);
  const completed = snapshot.status === 'completed';
  React.useEffect(() => {
    if (!completed || completedNotifiedRef.current) return;
    completedNotifiedRef.current = true;
    onCompletedRef.current?.();
  }, [completed]);

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
  runningTaskKey: number | null,
): boolean {
  // null means not interrupted; heldTaskKey is null if no task was running when
  // the interruption began.
  const [pause, setPause] = React.useState<{
    heldTaskKey: number | null;
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
