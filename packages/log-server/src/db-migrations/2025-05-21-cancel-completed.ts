import { type ColumnType, type GeneratedAlways, Kysely, sql } from 'kysely';
import type { JsonObject } from 'type-fest';

export type DbRunId = number;
export type DbExperimentId = number;
export type DbLogId = number;
export type DbLogSequenceId = number;

export type ExperimentTable = {
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
export type LogSequenceTable = {
  sequenceId: GeneratedAlways<DbLogSequenceId>;
  runId: ColumnType<DbRunId, number, never>;
  sequenceNumber: ColumnType<number, number, never>;
  start: ColumnType<number, number, never>;
};
export type LogTable = {
  logId: GeneratedAlways<DbLogId>;
  sequenceId: ColumnType<DbLogSequenceId, DbLogSequenceId, never>;
  logNumber: ColumnType<number, number, never>;
  // Logs with no types are used to fill in missing log numbers.
  canceledBy?: ColumnType<number, never, never>;
  logType?: string;
  logValues?: JsonObject;
};
export type RunLogView = {
  experimentId: ColumnType<DbExperimentId, never, never>;
  experimentName: ColumnType<string, never, never>;
  runId: ColumnType<DbRunId, never, never>;
  runName: ColumnType<string, never, never>;
  runStatus: ColumnType<RunStatus, never, never>;
  logId: ColumnType<DbLogId, never, never>;
  sequenceId: ColumnType<DbLogSequenceId, never, never>;
  logNumber: ColumnType<number, never, never>;
  logType?: ColumnType<string, never, never>;
  logValues?: ColumnType<JsonObject, never, never>;
};
export type LogPropertyNameTable = {
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

export async function up(db: Kysely<Database>) {
  await db.transaction().execute(async (trx) => {
    await sql`DROP TRIGGER prevent_run_status_update`.execute(trx);

    await sql`
      CREATE TRIGGER prevent_canceled_run_status_update
      BEFORE UPDATE ON run
      WHEN (
          SELECT run_status FROM run WHERE run.run_id = OLD.run_id
        ) = 'canceled'
      BEGIN
        SELECT RAISE(ABORT, 'Cannot update run status when the run is canceled');
      END;
    `.execute(trx);

    await sql`
      CREATE TRIGGER prevent_completed_run_status_update
      BEFORE UPDATE ON run
      WHEN (
        (
          (SELECT run_status FROM run WHERE run.run_id = OLD.run_id) = 'completed'
        ) AND (
          NEW.run_status <> 'canceled'
        )
      )
      BEGIN
        SELECT RAISE(ABORT, 'Completed runs can only be canceled');
      END;
    `.execute(trx);
  });
}

export async function down(db: Kysely<Database>) {
  await db.transaction().execute(async (trx) => {
    await sql`
      DROP TRIGGER IF EXISTS prevent_canceled_run_status_update
    `.execute(trx);
    await sql`
      DROP TRIGGER IF EXISTS prevent_completed_run_status_update
    `.execute(trx);
    await sql`
      CREATE TRIGGER prevent_run_status_update
      BEFORE UPDATE ON run
      WHEN (
          SELECT run_status FROM run WHERE run.run_id = OLD.run_id
        ) IN ('completed', 'canceled')
      BEGIN
        SELECT RAISE(ABORT, 'Cannot update run status when the run is completed or canceled');
      END;
    `.execute(trx);
  });
}
