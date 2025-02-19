// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface RegisterExperiment {
  // task: Task;
  // log: Log;
}

export type Typed<T extends string = string> = { type: T };

export type AnyTask = Typed & { [key: PropertyKey]: unknown };

export type RegisteredTask = RegisterExperiment extends { task: infer T }
  ? T extends Typed
    ? T
    : never
  : AnyTask;

export type AnyLog = Typed & { [key: PropertyKey]: unknown };
export type RegisteredLog = RegisterExperiment extends { log: infer L }
  ? L extends Typed
    ? L
    : never
  : AnyLog;
