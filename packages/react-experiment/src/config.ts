// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface RegisterExperiment {
  // task: Task;
}

export type BaseTask = {
  type: string;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyTask = BaseTask & { [key: string]: any };
export type RegisteredTask = RegisterExperiment extends Required<{
  task: infer T;
}>
  ? T extends BaseTask
    ? T
    : never
  : AnyTask;

export type ExperimentConfig<T extends BaseTask = RegisteredTask> = {
  tasks: Record<T['type'], React.ReactElement>;
  loading?: React.ReactElement;
  completed?: React.ReactElement;
};
