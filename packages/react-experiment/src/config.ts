// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface RegisterExperiment {
  // task: Task;
  // log: Log;
}

export interface Typed<T extends string = string> {
  type: T;
}

export interface AnyTask extends Typed {
  [key: PropertyKey]: unknown;
}

export type RegisteredTask = RegisterExperiment extends { task: infer T }
  ? T extends Typed
    ? T
    : never
  : AnyTask;

export interface AnyLog extends Typed {
  [key: PropertyKey]: unknown;
}

export type RegisteredLog = RegisterExperiment extends { log: infer L }
  ? L extends Typed
    ? L
    : never
  : AnyLog;
