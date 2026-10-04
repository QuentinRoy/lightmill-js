import type { SessionData } from 'express-session';
import { canAccessRun, canWriteRun } from './access.ts';
import { DataStoreError } from './data-store-errors.ts';
import type { DataStore, LogId, NewLog, RunId } from './data-store.ts';
import { addLogsToRun, RunRejection } from './run-lifecycle.ts';

/**
 * Why logs were refused. `index` is the position of the offending log in the
 * logs that were given.
 */
export type LogIntakeRejection =
  | { code: 'RUN_NOT_FOUND'; runId: RunId }
  | { code: 'RUN_NOT_OWNED'; runId: RunId }
  | { code: 'INVALID_RUN_STATUS'; runId: RunId }
  | { code: 'LOG_NUMBER_EXISTS'; runId: RunId; index: number; number: number };

export type LogIntakeOutcome =
  | { results: Array<{ logId: LogId; created: boolean }> }
  | { rejection: LogIntakeRejection };

/**
 * Adds logs to a run in one transaction, or answers why it cannot. The run is
 * read in the transaction adding the logs, so a run that ended since the
 * request arrived stores none. A refused request stores nothing.
 * Other errors, like a transaction conflict, are thrown.
 */
export async function addLogsToWritableRun(
  store: DataStore,
  sessionData: SessionData['data'],
  runId: RunId,
  logs: Array<NewLog>,
): Promise<LogIntakeOutcome> {
  // Checked before reading the store, so a run the session cannot access looks
  // the same as one that does not exist.
  if (!canAccessRun(sessionData, runId)) {
    return { rejection: { code: 'RUN_NOT_FOUND', runId } };
  }
  if (!canWriteRun(sessionData, runId)) {
    // Outside of a transaction, since it only reads: runs are never deleted
    // and never change session, so the answer cannot go stale.
    const [run] = await store.getRuns({ runId });
    const code = run === undefined ? 'RUN_NOT_FOUND' : 'RUN_NOT_OWNED';
    return { rejection: { code, runId } };
  }
  try {
    return {
      results: await store.withTransaction((tx) =>
        addLogsToRun(tx, runId, logs),
      ),
    };
  } catch (e) {
    const rejection = toRejection(e, runId, logs);
    if (rejection === undefined) throw e;
    return { rejection };
  }
}

function toRejection(
  e: unknown,
  runId: RunId,
  logs: Array<NewLog>,
): LogIntakeRejection | undefined {
  if (
    e instanceof RunRejection &&
    (e.code === 'RUN_NOT_FOUND' || e.code === 'INVALID_RUN_STATUS')
  ) {
    return { code: e.code, runId };
  }
  if (
    e instanceof DataStoreError &&
    e.code === 'LOG_NUMBER_EXISTS_IN_SEQUENCE'
  ) {
    const index = logs.findIndex((log) => log.number === e.logNumber);
    const log = logs[index];
    if (log === undefined) {
      throw new TypeError(
        `DataStore reported a conflict on log number ${e.logNumber}, which is not in the logs`,
        { cause: e },
      );
    }
    return { code: 'LOG_NUMBER_EXISTS', runId, index, number: log.number };
  }
  return undefined;
}
