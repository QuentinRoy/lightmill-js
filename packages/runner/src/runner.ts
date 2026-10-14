import {
  type MaybeAsyncIterator,
  type SuperIterator,
  toIterator,
} from './types.js';

export type TimelineRunnerParams<Task, TaskResult = unknown> = {
  timeline: SuperIterator<Task, TaskResult>;
  onTimelineStarted?: () => void;
  onLoading?: () => void;
  onTaskStarted?: (task: Task) => void;
  onTaskCompleted?: (task: Task) => void;
  onTimelineCanceled?: () => void;
  onError?: (error: unknown) => void;
  onTimelineCompleted?: () => void;
};

/**
 * Controls iterative execution of a timeline and emits lifecycle callbacks.
 *
 * @typeParam Task - Task type yielded by the timeline iterator.
 * @typeParam TaskResult - Task result passed back to the timeline iterator's
 * `next()`.
 */
export class TimelineRunner<Task, TaskResult = unknown> {
  onTimelineStarted?: () => void;
  onLoading?: () => void;
  onTaskStarted?: (task: Task) => void;
  onTaskCompleted?: (task: Task) => void;
  onTimelineCanceled?: () => void;
  onError?: (error: unknown) => void;
  onTimelineCompleted?: () => void;

  #iterator: MaybeAsyncIterator<Task, TaskResult>;
  #status:
    'running' | 'canceled' | 'completed' | 'idle' | 'loading' | 'crashed' =
    'idle';
  #currentTask: Task | null = null;
  #taskStartedCall: 'none' | 'active' | 'completed' = 'none';
  // The result of a task completed from inside onTaskStarted, for #toNext's
  // loop to pass on.
  #completedResult: [] | [TaskResult] = [];

  /**
   * Creates a timeline runner.
   *
   * @param options Runner options and lifecycle callbacks.
   */
  constructor(options: TimelineRunnerParams<Task, TaskResult>) {
    this.#iterator = toIterator(options.timeline);
    this.onTimelineStarted = options.onTimelineStarted;
    this.onTimelineCompleted = options.onTimelineCompleted;
    this.onTaskStarted = options.onTaskStarted;
    this.onTaskCompleted = options.onTaskCompleted;
    this.onLoading = options.onLoading;
    this.onError = options.onError;
    this.onTimelineCanceled = options.onTimelineCanceled;
  }

  /**
   * Current runner status.
   */
  get status() {
    return this.#status;
  }

  /**
   * Starts consuming tasks from the timeline.
   *
   * @returns The runner instance.
   * @throws {Error} If the runner has already started.
   */
  start() {
    if (this.#status !== 'idle') {
      throw new Error('Runner has already started');
    }
    this.#status = 'running';
    this.onTimelineStarted?.();
    if (this.status === 'canceled') return this;
    this.#toNext();
    return this;
  }

  /**
   * Marks the current task as completed and advances to the next one.
   *
   * @param result Task result, passed to the timeline iterator's `next()`.
   * Without it, `next()` is called without argument.
   * @returns The runner instance.
   * @throws {Error} If there is no running task or if the timeline is canceled.
   */
  completeTask(...result: [] | [TaskResult]) {
    if (this.#status === 'canceled') {
      throw new Error('Cannot complete task when timeline is canceled');
    }
    if (this.#status !== 'running') {
      throw new Error('No task is currently running');
    }
    if (this.#currentTask == null) {
      throw new Error('Internal error: current task is null');
    }
    if (this.#taskStartedCall === 'completed') {
      throw new Error('Task already completed');
    }
    this.onTaskCompleted?.(this.#currentTask);
    if (this.status === 'canceled') return this;
    // Advancing from inside onTaskStarted would recurse once per task and
    // overflow the stack on long sync timelines, so #toNext loops instead.
    if (this.#taskStartedCall === 'active') {
      this.#taskStartedCall = 'completed';
      this.#completedResult = result;
    } else {
      this.#toNext(...result);
    }
    return this;
  }

  /**
   * Cancels the timeline.
   *
   * @returns The runner instance.
   * @throws {Error} If the timeline is already canceled or completed.
   */
  cancel() {
    if (this.#status === 'canceled') {
      throw new Error('TimelineRunner is already canceled');
    }
    if (this.#status === 'completed') {
      throw new Error('TimelineRunner is already completed');
    }
    this.#status = 'canceled';
    this.onTimelineCanceled?.();
    return this;
  }

  #toNext(...result: [] | [TaskResult]) {
    while (true) {
      let next: ReturnType<MaybeAsyncIterator<Task>['next']>;
      try {
        next = this.#iterator.next(...result);
      } catch (error) {
        this.#handleNextTaskError(error);
        return;
      }
      if ('then' in next) {
        this.#status = 'loading';
        this.onLoading?.();
        next.then(
          (nextTask) => {
            if (this.#status === 'canceled') return;
            if (this.#startTask(nextTask)) this.#toNext(...this.#takeResult());
          },
          (error) => {
            if (this.#status === 'canceled') return;
            this.#handleNextTaskError(error);
          },
        );
        return;
      }
      if (!this.#startTask(next)) return;
      result = this.#takeResult();
    }
  }

  #takeResult() {
    const result = this.#completedResult;
    this.#completedResult = [];
    return result;
  }

  #handleNextTaskError(error: unknown) {
    this.#status = 'crashed';
    if (this.onError == null) {
      throw error;
    }
    this.onError(error);
  }

  /**
   * @returns Whether onTaskStarted completed the task, so the runner must
   * advance.
   */
  #startTask(nextTaskResult: IteratorResult<Task>): boolean {
    if (nextTaskResult.done) {
      this.#status = 'completed';
      this.onTimelineCompleted?.();
      return false;
    }
    this.#status = 'running';
    this.#currentTask = nextTaskResult.value;
    this.#taskStartedCall = 'active';
    try {
      this.onTaskStarted?.(this.#currentTask);
    } catch (error) {
      this.#endTaskStartedCall();
      // A cancel() from the callback must not be overwritten.
      if (this.status !== 'canceled') this.#status = 'crashed';
      throw error;
    }
    return (
      this.#endTaskStartedCall() === 'completed' && this.#status === 'running'
    );
  }

  #endTaskStartedCall() {
    const call = this.#taskStartedCall;
    this.#taskStartedCall = 'none';
    return call;
  }
}
