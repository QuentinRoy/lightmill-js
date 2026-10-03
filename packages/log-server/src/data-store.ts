import type { JsonObject, Merge, UnionToIntersection } from 'type-fest';
import type { AllFilter, ExperimentFilter, RunFilter } from './data-filters.ts';
import {
  runStatuses,
  type DbExperimentId,
  type DbLogId,
  type DbLogSequenceId,
  type DbRunId,
  type ExperimentTable,
  type LogPropertyNameTable,
  type LogSequenceTable,
  type LogTable,
  type RunLogView,
  type RunStatus,
  type RunTable,
} from './db-migrations/2026-09-28-gap-ranges.ts';
import type { Database } from './db-migrations/2026-10-02-lifecycle-rules.ts';

export {
  runStatuses,
  type Database,
  type DbExperimentId,
  type DbLogId,
  type DbLogSequenceId,
  type DbRunId,
  type ExperimentTable,
  type LogPropertyNameTable,
  type LogSequenceTable,
  type LogTable,
  type RunLogView,
  type RunStatus,
  type RunTable,
};

export type RunId = string;
export type ExperimentId = string;
export type LogId = string;

export interface Log {
  experimentId: ExperimentId;
  experimentName: string;
  runId: RunId;
  runName: string;
  runStatus: RunStatus;
  logId: LogId;
  number: number;
  type: string;
  // In practice, values is a JsonObject, but it's best not to use that type
  // as it causes more problems than it solves in this case, and type-fest
  // specifically recommends against using it as a return type.
  values: Record<string, unknown>;
}

export function fromDbId<I extends keyof IdsMap>(experimentId: I) {
  return experimentId.toString() as IdsMap[I];
}
export function toDbId<I extends keyof ReverseIdsMap>(id: I) {
  let parsedId = parseInt(id);
  if (Number.isNaN(parsedId)) {
    return -1 as ReverseIdsMap[I];
  }
  return parsedId as ReverseIdsMap[I];
}

type IdsMap = Record<DbExperimentId, ExperimentId> &
  Record<DbRunId, RunId> &
  Record<DbLogId, LogId>;
type ReverseIdsMap = UnionToIntersection<
  keyof IdsMap extends infer K
    ? K extends PropertyKey
      ? IdsMap extends Record<K, infer V extends PropertyKey>
        ? Record<V, K>
        : never
      : never
    : never
>;

export interface RunRecord {
  experimentId: ExperimentId;
  runId: RunId;
  runName: string | null;
  runStatus: RunStatus;
  runCreatedAt: Date;
  // The run's first missing log number, if any.
  firstMissingLogNumber: number | null;
  // The highest log number in the run that isn't stranded, or 0 if there is
  // none.
  lastLogNumber: number;
}

export interface ExperimentRecord {
  experimentId: ExperimentId;
  experimentName: string;
  experimentCreatedAt: Date;
}

export interface NewLog {
  type: string;
  number: number;
  // Always a JsonObject: it comes from a JSON request body.
  values: JsonObject;
}

/**
 * What can be read anywhere: on the store itself, or inside a transaction.
 */
interface DataStoreReader {
  /**
   * Gets experiments matching the provided filter
   * @param filter Optional filter to apply
   * @returns Array of matching experiment records
   */
  getExperiments(
    filter?: ExperimentFilter | undefined,
  ): Promise<ExperimentRecord[]>;

  /**
   * Gets runs matching the provided filter
   * @param filter Optional filter to apply
   * @returns Array of matching run records
   */
  getRuns(
    filter?: Merge<RunFilter, Pick<ExperimentFilter, 'experimentName'>>,
  ): Promise<RunRecord[]>;

  /**
   * Gets all unique log value property names that match the filter
   * @param filter Optional filter to apply
   * @returns Array of log property names
   */
  getLogValueNames(filter?: AllFilter | undefined): Promise<string[]>;

  /**
   * Gets the last log of each type for runs matching the filter
   * @param filter Optional filter to apply
   * @returns Array of last logs
   */
  getLastLogs(
    filter?: AllFilter | undefined,
  ): Promise<
    Array<{
      runId: RunId;
      logId: LogId;
      type: string;
      values: Record<string, unknown>;
      number: number;
    }>
  >;

  /**
   * Gets all logs matching the filter. On the store, this streams without
   * holding any lock between pulls. In a transaction, a pull after the
   * transaction ended rejects with `TRANSACTION_ENDED`.
   * @param filter Optional filter to apply
   * @returns AsyncGenerator yielding log entries
   */
  getLogs(filter?: AllFilter | undefined): AsyncGenerator<Log>;
}

/**
 * The store as seen inside `DataStore#withTransaction`: reads and writes.
 * Run lifecycle rules (which status can follow which, when logs are accepted)
 * are not part of this contract, and an implementation does not need to
 * enforce them. It only needs to reject what its backend states natively and
 * atomically, like a foreign key or a duplicate name. The transaction ends
 * when the callback finishes: every call afterwards rejects with
 * `TRANSACTION_ENDED`.
 *
 * After a rejected call, the callback must throw: the transaction is rolled
 * back, and nothing is promised about a transaction that kept going.
 */
export interface DataStoreTransaction extends DataStoreReader {
  /**
   * Adds a new experiment to the store
   * @param params The experiment parameters
   * @returns The newly created experiment record
   * @throws {DataStoreError} `EXPERIMENT_EXISTS` if an experiment with the same
   * name already exists
   */
  addExperiment(params: { experimentName: string }): Promise<ExperimentRecord>;

  /**
   * Adds a new run associated with an experiment
   * @param params Run creation parameters
   * @returns The newly created run record. Status is set to 'idle' by default.
   * @throws {DataStoreError} `RUN_EXISTS` if a run with the same name already
   * exists for the experiment, `EXPERIMENT_NOT_FOUND` if the experiment does
   * not exist
   */
  addRun(params: {
    runName?: string | null | undefined;
    experimentId: ExperimentId;
    runStatus?: RunStatus;
  }): Promise<RunRecord>;

  /**
   * Sets the status of a run, whatever it is now.
   * @param runId The run ID to update
   * @param status The new status
   * @throws {DataStoreError} `RUN_NOT_FOUND` if the run doesn't exist,
   * `RUN_EXISTS` if the status is not canceled and another run of the
   * experiment that is not canceled has the same name
   */
  setRunStatus(runId: RunId, status: RunStatus): Promise<void>;

  /**
   * Cancels the logs of a run numbered above `after`, which starts a new log
   * sequence: the logs stay stored, but stop counting. It does not change the
   * run's status. `after` must be at or below the run's last log number: what
   * an implementation does with a higher one is not part of the contract.
   * @param runId The run ID to cancel logs of
   * @param params.after The highest log number to keep
   * @throws {DataStoreError} `RUN_NOT_FOUND` if the run doesn't exist
   */
  cancelLogsAfter(runId: RunId, params: { after: number }): Promise<void>;

  /**
   * Adds logs to a run
   * @param runId The run ID to add logs to
   * @param logs The logs to add
   * @returns The ID of each log, in the order they were given. `created` is
   * false for a duplicate log: one the run already holds with the same number,
   * type, and values, which is not stored again.
   * @throws {DataStoreError} `RUN_NOT_FOUND` if the run doesn't exist, or
   * `LOG_NUMBER_EXISTS_IN_SEQUENCE` if a log number is already used with
   * different content (with the `logNumber` of the first conflicting log in
   * `logs`)
   */
  addLogs(
    runId: RunId,
    logs: Array<NewLog>,
  ): Promise<Array<{ logId: LogId; created: boolean }>>;
}

/**
 * Reads work anywhere, every write goes through `withTransaction`.
 *
 * The creator of a store owns it and closes it.
 */
export interface DataStore extends DataStoreReader {
  /**
   * Runs `fn` in a serializable transaction: the result is as if transactions
   * ran one at a time. It commits when `fn` resolves, and rolls back when it
   * throws: never call commit or rollback.
   *
   * `fn` must only make calls on its transaction, and await each of them. It
   * may run again after a `TRANSACTION_CONFLICT`, and the store holds a lock
   * while it runs. Transactions cannot be nested.
   *
   * @returns What `fn` returned.
   * @throws The error of `fn`, unchanged, if the transaction rolled back.
   * @throws {DataStoreError} `TRANSACTION_CONFLICT` if the transaction could
   * not be serialized or waited too long for a lock (nothing is persisted, and
   * trying again may succeed), `TRANSACTION_COMMIT_FAILED` if committing failed
   * otherwise, `TRANSACTION_ROLLBACK_FAILED` if rolling back failed (the
   * persisted state is unknown), `STORE_CLOSED` if the store was closed.
   * @throws {TypeError} If a transaction call was still pending when `fn`
   * finished (the transaction is rolled back).
   */
  withTransaction<T>(fn: (tx: DataStoreTransaction) => Promise<T>): Promise<T>;

  /**
   * Closes the store and releases any resources. It rejects new operations
   * with `STORE_CLOSED` at once, waits for the ones in flight, and may be called
   * many times. Calling it inside a `withTransaction` callback deadlocks.
   */
  close(): Promise<void>;
}
