import type { JsonObject } from 'type-fest';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface RegisterExperiment {
  // task: Task;
  // log: Log;
}

export interface Typed<T extends string = string> {
  type: T;
}

/** Identifies a task within its timeline. */
export type TaskId = string | number;

export interface AnyTask extends Typed {
  id: TaskId;
  [key: PropertyKey]: unknown;
}

export interface AnyLog extends Typed {
  [key: string]: unknown;
}

// The helpers ending in Of take the registration as a parameter, so type tests
// can pass their own rather than augment RegisterExperiment for every test.

export type TaskOf<R> = R extends { task: infer T }
  ? T extends Typed & { id: TaskId }
    ? T
    : never
  : AnyTask;

export type LogOf<R> = R extends { log: infer L }
  ? L extends Typed
    ? L
    : never
  : AnyLog;

export type RegisteredTask = TaskOf<RegisterExperiment>;

export type RegisteredLog = LogOf<RegisterExperiment>;

/** Keys of a completion log that a task result cannot hold. */
export const reservedKeys = ['type', 'taskId', 'date'] as const;

export type ReservedKey = (typeof reservedKeys)[number];

// Task types are reserved for completion logs. Without registered tasks, any
// string could be one, so none is.
type TaskTypeOf<R> = R extends { task: infer T extends Typed }
  ? T['type']
  : never;

/** The logs a task writes with `useLogger`: all but completion logs. */
export type LoggableLogOf<R> = Exclude<LogOf<R>, { type: TaskTypeOf<R> }>;

export type LoggableLog = LoggableLogOf<RegisterExperiment>;

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

/**
 * The result of a task of type `T`: its completion log, the registered log of
 * the same type, without its reserved keys. `never` when there is no such log.
 */
export type TaskResultOf<R, T extends string> = R extends { log: unknown }
  ? DistributiveOmit<Extract<LogOf<R>, { type: T }>, ReservedKey>
  : Record<string, unknown>;

// A result must come back unchanged when a run is replayed, whatever the client
// sends it through, so it holds JSON values only.
type ResultArgument<T> = T & JsonObject & { [K in ReservedKey]?: never };

export type CompleteTaskOf<R, T extends string> = [TaskResultOf<R, T>] extends [
  never,
]
  ? () => void
  : // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    {} extends TaskResultOf<R, T>
    ? (result?: ResultArgument<TaskResultOf<R, T>>) => void
    : (result: ResultArgument<TaskResultOf<R, T>>) => void;
