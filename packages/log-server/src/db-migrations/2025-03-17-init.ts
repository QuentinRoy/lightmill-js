import { ColumnType, GeneratedAlways, Kysely, sql } from 'kysely';
import { JsonObject, Tagged } from 'type-fest';

type DbRunId = Tagged<number, 'RunId'>;
type DbExperimentId = Tagged<number, 'ExperimentId'>;
type DbLogId = Tagged<number, 'LogId'>;
type DbLogSequenceId = Tagged<number, 'LogSequenceId'>;

type ExperimentTable = {
  experimentId: GeneratedAlways<DbExperimentId>;
  experimentName: ColumnType<string, string, never>;
  // We use ColumnType to indicate that the column cannot be updated.
  experimentCreatedAt: ColumnType<string, string, never>;
};
const runStatuses = [
  'idle',
  'running',
  'completed',
  'canceled',
  'interrupted',
] as const;
export type RunStatus = (typeof runStatuses)[number];
type RunTable = {
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
  logValues?: JsonObject;
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
type Database = {
  experiment: ExperimentTable;
  run: RunTable;
  logSequence: LogSequenceTable;
  log: LogTable;
  runLogView: RunLogView;
  logPropertyName: LogPropertyNameTable;
};

export async function up(db: Kysely<Database>) {
  await db.transaction().execute(async (trx) => {
    await trx.schema
      .createTable('experiment')
      .addColumn('experimentId', 'integer', (column) =>
        column.notNull().primaryKey(),
      )
      .addColumn('experimentName', 'text', (column) =>
        column.notNull().unique(),
      )
      .addColumn('experimentCreatedAt', 'text', (column) => column.notNull())
      .modifyEnd(sql`strict`)
      .execute();

    await trx.schema
      .createTable('run')
      .addColumn('runId', 'integer', (column) => column.notNull().primaryKey())
      .addColumn('experimentId', 'integer', (column) => column.notNull())
      .addColumn('runName', 'text')
      .addColumn('runStatus', 'text', (column) => column.notNull())
      .addColumn('runCreatedAt', 'text', (column) => column.notNull())
      .addForeignKeyConstraint(
        'ForeighRunExperiment',
        ['experimentId'],
        'experiment',
        ['experimentId'],
      )
      .addCheckConstraint(
        'RunStatusCheck',
        sql.raw(
          `run_status IN (${runStatuses.map((s) => `'${s}'`).join(', ')})`,
        ),
      )
      .modifyEnd(sql`strict`)
      .execute();

    await trx.schema
      .createIndex('experimentRunNameIndex')
      .on('run')
      .columns(['experimentId', 'runName'])
      .execute();

    // Refuse to insert a run with the same name for the same experiment if another run with the same name for the same experiment exists and is not canceled.
    await sql`
          CREATE TRIGGER prevent_run_insert
          BEFORE INSERT ON run
          WHEN NEW.run_name IS NOT NULL
          BEGIN
              SELECT RAISE(ABORT, 'Cannot insert run when another run with the same name for the same experiment exists and is not canceled')
              FROM run
              WHERE (
                run.experiment_id = NEW.experiment_id AND
                run.run_name = NEW.run_name AND
                run.run_status <> 'canceled'
              );
          END;
        `.execute(trx);

    // Refuse to update run status if the run is completed or canceled.
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

    await trx.schema
      .createTable('logSequence')
      .addColumn('sequenceId', 'integer', (column) => column.primaryKey())
      .addColumn('runId', 'integer', (column) => column.notNull())
      .addColumn('sequenceNumber', 'integer', (column) =>
        column.notNull().check(sql`sequence_number > 0`),
      )
      .addColumn('start', 'integer', (column) =>
        // Make sure that the start number is greater than zero.
        column.notNull().check(sql`start > 0`),
      )
      // This creates an index on the columns (so no need to create another) and
      // prevents duplicate rows.
      .addUniqueConstraint('LogSequenceUnique', ['runId', 'sequenceNumber'])
      .addForeignKeyConstraint('ForeignLogSequenceRun', ['runId'], 'run', [
        'runId',
      ])
      .modifyEnd(sql`strict`)
      .execute();

    // Prevent any update of logSequence
    await sql`
          CREATE TRIGGER prevent_log_sequence_update
          BEFORE UPDATE ON log_sequence
          BEGIN
            SELECT RAISE(ABORT, 'Cannot update existing log sequence');
          END;
        `.execute(trx);
    await sql`
          CREATE TRIGGER prevent_log_sequence_delete
          BEFORE DELETE ON log_sequence
          BEGIN
            SELECT RAISE(ABORT, 'Cannot delete existing log sequence');
          END;
        `.execute(trx);

    await trx.schema
      .createTable('log')
      .addColumn('logId', 'integer', (column) => column.primaryKey())
      .addColumn('sequenceId', 'integer', (column) => column.notNull())
      .addColumn('logNumber', 'integer', (column) => column.notNull())
      // Empty means missing log.
      .addColumn('logType', 'text')
      .addColumn('logValues', 'blob')
      .addColumn('canceledBy', 'integer')
      // This creates an index on the columns (so no need to create another) and
      // prevents duplicate rows.
      .addUniqueConstraint('UniqueLog', ['sequenceId', 'logNumber'])
      .addForeignKeyConstraint(
        'ForeignLogSequenceId',
        ['sequenceId'],
        'logSequence',
        ['sequenceId'],
      )
      .addForeignKeyConstraint(
        'ForeignLogCanceledBy',
        ['canceledBy'],
        'logSequence',
        ['sequenceId'],
      )
      .modifyEnd(sql`strict`)
      .execute();

    await trx.schema
      .createIndex('logSequenceIdTypeNumberIndex')
      .on('log')
      .columns(['sequenceId', 'logType', 'logNumber'])
      .execute();

    // Prevent updates of log rows, except for log_type when
    // it is null, and canceled_by when it is null.
    await sql`
          CREATE TRIGGER prevent_log_update
          BEFORE UPDATE ON log
          WHEN (
            -- Whatever happens, log_number and log_id cannot change.
            OLD.log_number <> NEW.log_number
            OR OLD.log_id <> NEW.log_id
            OR NOT (
              (
                -- acceptable update 1: canceling a log, but in this case,
                -- the log type and value must remain unchanged.
                NEW.canceled_by IS NOT NULL
                AND OLD.canceled_by IS NULL
                AND OLD.log_type = NEW.log_type
                AND OLD.log_values = NEW.log_values
              ) OR (
                -- acceptable update 2: setting the value of an empty log
                OLD.log_type IS NULL
                AND NEW.log_type IS NOT NULL
                AND NEW.log_values IS NOT NULL
                AND NEW.canceled_by = OLD.canceled_by
              )
            )
          )
          BEGIN
            SELECT RAISE(ABORT, 'Cannot update a log whose type is not null');
          END;
        `.execute(trx);
    // Prevent deletion of log rows whose current type column is not null.
    await sql`
          CREATE TRIGGER prevent_log_delete
          BEFORE DELETE ON log
          WHEN OLD.log_type IS NOT NULL
          BEGIN
            SELECT RAISE(ABORT, 'Cannot delete a log whose type is not null');
          END;
        `.execute(trx);
    // Prevent inserts of log whose number is smaller than its sequence start.
    await sql`
          CREATE TRIGGER prevent_small_number_log_insert
          BEFORE INSERT ON log
          WHEN NEW.log_number < (
            SELECT start FROM log_sequence WHERE sequence_id = NEW.sequence_id
          )
          BEGIN
            SELECT RAISE(ABORT, 'Cannot insert log with log_number smaller than its sequence start');
          END;
        `.execute(trx);
    // Prevent inserts of log when the corresponding run is not running.
    await sql`
          CREATE TRIGGER prevent_non_running_run_log_insert
          BEFORE INSERT ON log
          WHEN (
            SELECT run.run_status FROM log_sequence
            INNER JOIN run ON run.run_id = log_sequence.run_id
            WHERE log_sequence.sequence_id = NEW.sequence_id
          ) <> 'running'
          BEGIN
            SELECT RAISE(ABORT, 'Cannot insert log in non-running run');
          END;
      `.execute(trx);

    // Prevent inserts of log when the corresponding run is not running.
    await sql`
        CREATE TRIGGER mark_canceled_logs_on_sequence_insert
        AFTER INSERT ON log_sequence
        BEGIN
          UPDATE log
          SET canceled_by = NEW.sequence_id
          WHERE log.canceled_by IS NULL
            AND log.sequence_id IN (
              SELECT sequence_id
              FROM log_sequence
              WHERE run_id = NEW.run_id
            )
            AND log.log_number >= NEW.start;
        END;
      `.execute(trx);

    // There should already be an index to select logs by sequenceId and
    // number, but we need to create an index to select logs by sequenceId,
    // type, and number.
    await trx.schema
      .createIndex('logSequenceTypeNumber')
      .on('log')
      .columns(['sequenceId', 'logType', 'logNumber'])
      .execute();

    await trx.schema
      .createView('runLogView')
      .as(
        trx
          .selectFrom('log')
          .innerJoin('logSequence as seq', 'log.sequenceId', 'seq.sequenceId')
          .innerJoin('run', 'run.runId', 'seq.runId')
          .leftJoin('experiment', 'experiment.experimentId', 'run.experimentId')
          .where('log.canceledBy', 'is', null)
          .select([
            'experiment.experimentId',
            'experiment.experimentName',
            'run.runId',
            'run.runName',
            'run.runStatus',
            'log.logId',
            'log.logNumber',
            'log.logType',
            'log.logValues',
          ]),
      )
      .execute();

    await trx.schema
      .createTable('logPropertyName')
      .addColumn('logId', 'integer', (column) => column.notNull())
      .addColumn('logPropertyName', 'text', (column) => column.notNull())
      .addForeignKeyConstraint('ForeignLogValueslogId', ['logId'], 'log', [
        'logId',
      ])
      .addPrimaryKeyConstraint('logValuesPrimaryKey', [
        'logId',
        'logPropertyName',
      ])
      .modifyEnd(sql`strict`)
      .execute();

    await sql`
          CREATE TRIGGER prevent_log_property_name_update
          BEFORE UPDATE ON log_property_name
          BEGIN
            SELECT RAISE(ABORT, 'Cannot update existing log value');
          END;
        `.execute(trx);
    await sql`
          CREATE TRIGGER prevent_log_property_name_delete
          BEFORE DELETE ON log_property_name
          BEGIN
            SELECT RAISE(ABORT, 'Cannot delete existing log value');
          END;
        `.execute(trx);
  });
}
