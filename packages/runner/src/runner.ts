import { SuperIterator } from './types.js';

export type TimelineRunnerParams<Task> = {
  timeline: SuperIterator<Task>;
  onTimelineStarted?: () => void;
  onLoading?: () => void;
  onTaskStarted?: (task: Task) => void;
  onTaskCompleted?: (task: Task) => void;
  onTimelineCanceled?: () => void;
  onError?: (error: unknown) => void;
  onTimelineCompleted?: () => void;
};

export class TimelineRunner<Task> {
  onTimelineStarted?: () => void;
  onLoading?: () => void;
  onTaskStarted?: (task: Task) => void;
  onTaskCompleted?: (task: Task) => void;
  onTimelineCanceled?: () => void;
  onError?: (error: unknown) => void;
  onTimelineCompleted?: () => void;

  #iterator: Iterator<Task> | AsyncIterator<Task>;
  #status:
    | 'running'
    | 'canceled'
    | 'completed'
    | 'idle'
    | 'loading'
    | 'crashed' = 'idle';
  #currentTask: Task | null = null;

  constructor(options: TimelineRunnerParams<Task>) {
    if (Symbol.iterator in options.timeline) {
      this.#iterator = options.timeline[Symbol.iterator]();
    } else if (Symbol.asyncIterator in options.timeline) {
      this.#iterator = options.timeline[Symbol.asyncIterator]();
    } else {
      this.#iterator = options.timeline;
    }
    this.onTimelineStarted = options.onTimelineStarted;
    this.onTimelineCompleted = options.onTimelineCompleted;
    this.onTaskStarted = options.onTaskStarted;
    this.onTaskCompleted = options.onTaskCompleted;
    this.onLoading = options.onLoading;
    this.onError = options.onError;
    this.onTimelineCanceled = options.onTimelineCanceled;
  }

  get status() {
    return this.#status;
  }

  start() {
    if (this.#status !== 'idle') {
      throw new Error('Runner has already started');
    }
    this.#status = 'running';
    this.onTimelineStarted?.();
    this.#toNext();
    return this;
  }

  completeTask() {
    if (this.#status === 'canceled') {
      throw new Error('Cannot complete task when timeline is canceled');
    }
    if (this.#status !== 'running') {
      throw new Error('No task is currently running');
    }
    if (this.#currentTask == null) {
      throw new Error('Internal error: current task is null');
    }
    this.onTaskCompleted?.(this.#currentTask);
    this.#toNext();
    return this;
  }

  cancel() {
    if (this.#status === 'canceled') {
      throw new Error('TimelineRunner is already canceled');
    }
    if (this.#status === 'completed') {
      throw new Error('TimelineRunner is already completed');
    }
    this.#status = 'canceled';
    return this;
  }

  #toNext() {
    const next = this.#iterator.next();
    if ('then' in next) {
      this.#status = 'loading';
      this.onLoading?.();
      next.then(
        (...args) => this.#handleNextTaskResult(...args),
        (...args) => this.#handleNextTaskError(...args),
      );
    } else {
      this.#handleNextTaskResult(next);
    }
  }

  #handleNextTaskError(error: unknown) {
    this.#status = 'crashed';
    if (this.onError == null) {
      throw error;
    }
    this.onError(error);
  }

  #handleNextTaskResult(nextTaskResult: IteratorResult<Task>) {
    if (nextTaskResult.done) {
      this.#status = 'completed';
      this.onTimelineCompleted?.();
    } else {
      this.#status = 'running';
      this.#currentTask = nextTaskResult.value;
      this.onTaskStarted?.(this.#currentTask);
    }
  }
}
