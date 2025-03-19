import { ColumnType, GeneratedAlways } from 'kysely';
import { JsonObject, Tagged, UnionToIntersection } from 'type-fest';

export type RunId = Tagged<string, 'RunId'>;
export type ExperimentId = Tagged<string, 'ExperimentId'>;
export type LogId = Tagged<string, 'LogId'>;

export type DbRunId = Tagged<number, 'RunId'>;
export type DbExperimentId = Tagged<number, 'ExperimentId'>;
export type DbLogId = Tagged<number, 'LogId'>;
export type DbLogSequenceId = Tagged<number, 'LogSequenceId'>;

type ExperimentTable = {
  experimentId: GeneratedAlways<DbExperimentId>;
  experimentName: ColumnType<string, string, never>;
  // We use ColumnType to indicate that the column cannot be updated.
  experimentCreatedAt: ColumnType<string, string, never>;
};
export const runStatuses = [
  'idle',
  'running',
  'completed',
  'canceled',
  'interrupted',
] as const;
export type RunStatus = (typeof runStatuses)[number];
export type RunTable = {
  runId: GeneratedAlways<DbRunId>;
  experimentId: ColumnType<DbExperimentId, DbExperimentId, never>;
  runName?: ColumnType<string, string, never>;
  runStatus: RunStatus;
  runCreatedAt: ColumnType<string, string, never>;
};
type LogSequenceTable = {
  sequenceId: GeneratedAlways<DbLogSequenceId>;
  runId: ColumnType<DbRunId, number, never>;
  sequenceNumber: ColumnType<number, number, never>;
  start: ColumnType<number, number, never>;
};
type LogTable = {
  logId: GeneratedAlways<DbLogId>;
  sequenceId: ColumnType<DbLogSequenceId, DbLogSequenceId, never>;
  logNumber: ColumnType<number, number, never>;
  // Logs with no types are used to fill in missing log numbers.
  canceledBy?: ColumnType<number, never, never>;
  logType?: string;
  logValues?: ColumnType<JsonObject, JsonObject, never>;
};
type RunLogView = {
  experimentId: ColumnType<DbExperimentId, never, never>;
  experimentName: ColumnType<string, never, never>;
  runId: ColumnType<DbRunId, never, never>;
  runName: ColumnType<string, never, never>;
  runStatus: ColumnType<RunStatus, never, never>;
  logId: ColumnType<DbLogId, never, never>;
  logNumber: ColumnType<number, never, never>;
  logType?: ColumnType<string, never, never>;
  logValues?: ColumnType<JsonObject, never, never>;
};
type LogPropertyNameTable = {
  logId: ColumnType<DbLogId, number, never>;
  logPropertyName: ColumnType<string, string, never>;
};
export type Database = {
  experiment: ExperimentTable;
  run: RunTable;
  logSequence: LogSequenceTable;
  log: LogTable;
  runLogView: RunLogView;
  logPropertyName: LogPropertyNameTable;
};

export type Log = {
  experimentId: ExperimentId;
  experimentName: string;
  runId: RunId;
  runName: string;
  runStatus: RunStatus;
  logId: LogId;
  number: number;
  type: string;
  values: JsonObject;
};

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
