// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface RegisterExperiment {
  // task: Task;
  // log: Log;
}

export type BaseLog = {
  type: string;
};

export type BaseTask = {
  type: string;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyTask = BaseTask & { [key: string]: any };
export type RegisteredTask = RegisterExperiment extends { task: infer T }
  ? T extends BaseTask
    ? T
    : never
  : AnyTask;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyLog = BaseLog & { [key: string]: any };
export type RegisteredLog = RegisterExperiment extends { log: infer T }
  ? T extends BaseLog
    ? T
    : never
  : BaseLog;

export type RunConfig<T extends BaseTask = RegisteredTask> = {
  tasks: Record<T['type'], React.ReactElement>;
  loading?: React.ReactElement;
  completed?: React.ReactElement;
};
