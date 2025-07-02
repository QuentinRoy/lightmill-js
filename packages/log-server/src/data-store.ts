import type { JsonObject, Merge, UnionToIntersection } from 'type-fest';
import type { AllFilter, ExperimentFilter, RunFilter } from './data-filters.ts';
import {
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
} from './db-migrations/2025-05-21-cancel-completed.ts';

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
}

export interface ExperimentRecord {
  experimentId: ExperimentId;
  experimentName: string;
  experimentCreatedAt: Date;
}

export interface DataStore {
  /**
   * Adds a new experiment to the store
   * @param params The experiment parameters
   * @returns The newly created experiment record
   * @throws {StoreError} If an experiment with the same name already exists
   */
  addExperiment(params: { experimentName: string }): Promise<ExperimentRecord>;

  /**
   * Gets experiments matching the provided filter
   * @param filter Optional filter to apply
   * @returns Array of matching experiment records
   */
  getExperiments(
    filter?: ExperimentFilter | undefined,
  ): Promise<ExperimentRecord[]>;

  /**
   * Adds a new run associated with an experiment
   * @param params Run creation parameters
   * @returns The newly created run record. Status is set to 'idle' by default.
   * @throws {StoreError} If a run with the same name already exists for the experiment
   */
  addRun(params: {
    runName?: string | null | undefined;
    experimentId: ExperimentId;
    runStatus?: RunStatus;
  }): Promise<RunRecord>;

  /**
   * Resumes a run from a specific log number
   * @param runId The run ID to resume
   * @param params Resume parameters
   * @throws {StoreError} If the run doesn't exist or if resumption would leave log numbers missing
   */
  resumeRun(runId: RunId, params: { after: number }): Promise<void>;

  /**
   * Gets runs matching the provided filter
   * @param filter Optional filter to apply
   * @returns Array of matching run records
   */
  getRuns(
    filter?: Merge<RunFilter, Pick<ExperimentFilter, 'experimentName'>>,
  ): Promise<RunRecord[]>;

  /**
   * Updates the status of a run
   * @param runId The run ID to update
   * @param status The new status
   * @throws {StoreError} If the run doesn't exist or if the status transition is invalid
   */
  setRunStatus(runId: RunId, status: RunStatus): Promise<void>;

  /**
   * Adds logs to a run
   * @param runId The run ID to add logs to
   * @param logs The logs to add
   * @returns Array of created log IDs
   * @throws {StoreError} If the run doesn't exist or if there are log number conflicts
   */
  addLogs(
    runId: RunId,
    logs: Array<{ type: string; number: number; values: JsonObject }>,
  ): Promise<{ logId: LogId }[]>;

  /**
   * Gets all unique log value property names that match the filter
   * @param filter Optional filter to apply
   * @returns Array of log property names
   */
  getLogValueNames(filter?: AllFilter | undefined): Promise<string[]>;

  /**
   * Gets the count of pending logs for runs matching the filter
   * @param filter Filter to apply
   * @returns Array of run IDs with their pending log counts
   */
  getMissingLogs(
    filter?: Merge<RunFilter, Pick<ExperimentFilter, 'experimentName'>>,
  ): Promise<{ runId: RunId; logNumber: number }[]>;

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
   * Gets all logs matching the filter
   * @param filter Optional filter to apply
   * @returns AsyncGenerator yielding log entries
   */
  getLogs(filter?: AllFilter | undefined): AsyncGenerator<Log>;

  /**
   * Migrates the database to the latest schema version
   * @throws {StoreError} If migration fails
   */
  migrateDatabase(): Promise<void>;

  /**
   * Closes the store and releases any resources
   */
  close(): Promise<void>;
}
