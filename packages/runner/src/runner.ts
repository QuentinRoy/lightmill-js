import run, { RunProps, SuperIterator } from './run.js';
export { run, RunProps };

export type BaseTask = { type: string };
export type RunnerProps<Task extends BaseTask> = {
  tasks: {
    [K in Task['type']]: TaskHander<Task & { type: K }>;
  };
  onExperimentStarted?: () => void;
  onLoading?: () => void;
  onExperimentCompleted?: () => void;
};
export type RunnerInstance<Task extends BaseTask> = {
  run: (taskIterator: SuperIterator<Task>) => PromiseLike<void>;
} & RunnerProps<Task>;

export type TaskHander<Task = BaseTask> = (task: Task) => PromiseLike<void>;
export type TaskHandlers<Task extends { type: string }> = {
  [K in Task['type']]: TaskHander<Task & { type: K }>;
};

export class Runner<Task extends BaseTask> {
  #state: 'idle' | 'running' | 'loading' | 'completed' | 'error' = 'idle';
  tasks: TaskHandlers<Task>;
  onExperimentStarted?: () => void;
  onLoading?: () => void;
  onExperimentCompleted?: () => void;

  constructor(props: RunnerProps<Task>) {
    this.tasks = { ...props.tasks };
    this.onExperimentStarted = props.onExperimentStarted;
    this.onLoading = props.onLoading;
    this.onExperimentCompleted = props.onExperimentCompleted;
  }

  get state() {
    return this.#state;
  }

  async #runTask(task: Task) {
    let type: Task['type'] = task.type;
    this.#state = 'running';
    await this.tasks[type](task);
    this.#state = 'loading';
    this.onLoading?.();
  }

  async run(taskIterator: SuperIterator<Task>) {
    try {
      this.#state = 'loading';
      this.onExperimentStarted?.();
      this.onLoading?.();
      await run({ taskIterator, runTask: this.#runTask.bind(this) });
      this.#state = 'completed';
      this.onExperimentCompleted?.();
    } catch (error) {
      this.#state = 'error';
      throw error;
    }
  }
}
