import { UnionToIntersection } from 'type-fest';
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
} from './db-migrations/2025-03-17-init.js';

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

export type Log = {
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
