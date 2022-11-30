// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface RegisterExperiment {
  // task: Task;
}

export type BaseTask = {
  type: string;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyTask = BaseTask & { [key: string]: any };
export type RegisteredTask = RegisterExperiment extends {
  task: infer T;
}
  ? T
  : AnyTask;

export type ExperimentConfig = Record<
  RegisteredTask['type'],
  React.ComponentType
>;
