import { ColumnType, GeneratedAlways, Kysely, sql } from 'kysely';
import { Tagged } from 'type-fest';

const runStatuses = [
  'idle',
  'running',
  'completed',
  'canceled',
  'interrupted',
] as const;

type RunStatus = (typeof runStatuses)[number];

export type RunId = Tagged<number, 'RunId'>;

// We use ColumnType to indicate that the column cannot be updated.
type RunTable = {
  runId: GeneratedAlways<RunId>;
  runName: ColumnType<string, string, never>;
  experimentName: ColumnType<string, string, never>;
  runStatus: RunStatus;
  runCreatedAt: ColumnType<string, string, never>;
};
type LogSequenceTable = {
  sequenceId: GeneratedAlways<number>;
  runId: ColumnType<RunId, RunId, never>;
  sequenceNumber: ColumnType<number, number, never>;
  start: ColumnType<number, number, never>;
};
type logTable = {
  logId: GeneratedAlways<number>;
  sequenceId: ColumnType<number, number, never>;
  logNumber: ColumnType<number, number, never>;
  // Logs with no types are used to fill in missing log numbers.
  type?: string;
};
type RunLogView = {
  runId: ColumnType<number, never, never>;
  experimentName: ColumnType<string, never, never>;
  runName: ColumnType<string, never, never>;
  runStatus: ColumnType<RunStatus, never, never>;
  sequenceId: ColumnType<number, never, never>;
  sequenceNumber: ColumnType<number, never, never>;
  logId: ColumnType<number, never, never>;
  logNumber: ColumnType<number, never, never>;
  type?: ColumnType<string, never, never>;
};
type LogValueTable = {
  logId: ColumnType<number, number, never>;
  name: ColumnType<string, string, never>;
  value: ColumnType<string, string, never>;
};
type Database = {
  run: RunTable;
  logSequence: LogSequenceTable;
  log: logTable;
  runLogView: RunLogView;
  logValue: LogValueTable;
};

type OldRunTable = {
  runId: ColumnType<string, never, never>;
  experimentId: ColumnType<string, never, never>;
  status: 'running' | 'completed' | 'canceled';
};
type OldLogSequenceTable = {
  sequenceId: ColumnType<number, never, never>;
  experimentId: ColumnType<string, never, never>;
  runId: ColumnType<string, never, never>;
  sequenceNumber: ColumnType<number, never, never>;
  start: ColumnType<number, never, never>;
};
type OldLogTable = {
  logId: ColumnType<number, never, never>;
  sequenceId: ColumnType<number, never, never>;
  logNumber: ColumnType<number, never, never>;
  // Logs with no types are used to fill in missing log numbers.
  type: ColumnType<string | null, never, never>;
};
type OldLogValueTable = {
  logId: ColumnType<number, never, never>;
  name: ColumnType<string, never, never>;
  value: ColumnType<string, never, never>;
};

type DevDatabase = {
  sqliteMaster: { type: string; name: string };
  runOld: OldRunTable;
  logSequenceOld: OldLogSequenceTable;
  logOld: OldLogTable;
  logValueOld: OldLogValueTable;
};

export async function up(db: Kysely<Database & DevDatabase>) {
  await db.transaction().execute(async (trx) => {
    await trx.schema.dropIndex('logSelectWithType').execute();
    await trx.schema.dropView('runLogView').execute();
    await trx.schema.alterTable('run').renameTo('runOld').execute();
    await trx.schema
      .alterTable('logSequence')
      .renameTo('logSequenceOld')
      .execute();
    await trx.schema.alterTable('log').renameTo('logOld').execute();
    await trx.schema.alterTable('logValue').renameTo('logValueOld').execute();
    const triggers = await trx
      .selectFrom('sqliteMaster')
      .where('type', '=', 'trigger')
      .select('name')
      .execute();
    await Promise.all(
      triggers.map((trigger) =>
        sql`DROP TRIGGER ${sql.lit(trigger.name)}`.execute(trx),
      ),
    );

    await trx.schema
      .createTable('run')
      .addColumn('runId', 'integer', (column) => column.notNull().primaryKey())
      .addColumn('runName', 'text', (column) => column.notNull())
      .addColumn('experimentName', 'text', (column) => column.notNull())
      .addColumn('runStatus', 'text', (column) => column.notNull())
      .addColumn('runCreatedAt', 'datetime', (column) => column.notNull())
      .addCheckConstraint(
        'RunStatusCheck',
        sql.raw(
          `run_status IN (${runStatuses.map((s) => `'${s}'`).join(', ')})`,
        ),
      )
      .execute();

    await trx.schema
      .createIndex('experimentRunNameIndex')
      .on('run')
      .columns(['experimentName', 'runName'])
      .execute();

    await sql`
      CREATE TRIGGER prevent_run_insert
      BEFORE INSERT ON run
      BEGIN
          SELECT RAISE(ABORT, 'Cannot insert run when another run with the same name and experiment name exists and is not canceled')
          FROM run WHERE (
            run.run_name = NEW.run_name AND
            run.experiment_name = NEW.experiment_name AND
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
      .createIndex('ExperimentAndRunNameIndex')
      .on('run')
      .columns(['experimentName', 'runName'])
      .execute();

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
      .addUniqueConstraint('logSequenceUnique', ['runId', 'sequenceNumber'])
      .addForeignKeyConstraint('ForeignLogSequenceRun', ['runId'], 'run', [
        'runId',
      ])
      .execute();

    await trx.schema
      .createTable('log')
      .addColumn('logId', 'integer', (column) => column.primaryKey())
      .addColumn('sequenceId', 'integer', (column) => column.notNull())
      .addColumn('logNumber', 'integer', (column) => column.notNull())
      // Empty means missing log.
      .addColumn('type', 'text')
      // This creates an index on the columns (so no need to create another) and
      // prevents duplicate rows.
      .addUniqueConstraint('UniqueLog', ['sequenceId', 'logNumber'])
      .addForeignKeyConstraint(
        'ForeignLogSequenceId',
        ['sequenceId'],
        'logSequence',
        ['sequenceId'],
      )
      .execute();
    // Prevent updates of log rows whose current type column is not null.
    await sql`
      CREATE TRIGGER prevent_log_update
      BEFORE UPDATE ON log
      WHEN OLD.type IS NOT NULL
      BEGIN
        SELECT RAISE(ABORT, 'Cannot update a log whose type is not null');
      END;
    `.execute(trx);
    // Prevent deletion of log rows whose current type column is not null.
    await sql`
      CREATE TRIGGER prevent_log_delete
      BEFORE DELETE ON log
      WHEN OLD.type IS NOT NULL
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

    // There should already be an index to select logs by sequenceId and
    // number, but we need to create an index to select logs by sequenceId,
    // type, and number.
    await trx.schema
      .createIndex('logSelectWithType')
      .on('log')
      .columns(['sequenceId', 'type', 'logNumber'])
      .execute();

    await trx.schema
      .createView('runLogView')
      .as(
        trx
          .with('logSequenceWithEnd', (query) =>
            query
              .selectFrom('logSequence as seq')
              .leftJoin(
                ({ selectFrom }) =>
                  selectFrom('logSequence as nextSeq')
                    .select(['runId', 'sequenceNumber', 'start'])
                    .as('nextSeq'),
                (join) =>
                  join
                    .onRef('nextSeq.runId', '=', 'seq.runId')
                    .onRef('nextSeq.sequenceNumber', '>', 'seq.sequenceNumber'),
              )
              .groupBy(['seq.sequenceId'])
              .select((eb) => [
                'seq.sequenceId',
                'seq.runId',
                'seq.sequenceNumber',
                eb.fn.min('nextSeq.start').as('end'),
              ]),
          )
          .selectFrom('log')
          .innerJoin('logSequenceWithEnd as seq', (join) =>
            join.onRef('seq.sequenceId', '=', 'log.sequenceId'),
          )
          .where((eb) =>
            eb.or([
              eb('seq.end', 'is', null),
              eb('log.logNumber', '<', eb.ref('seq.end')),
            ]),
          )
          .innerJoin('run', (join) => join.onRef('run.runId', '=', 'seq.runId'))
          .select([
            'run.runId',
            'run.experimentName',
            'run.runName',
            'run.runStatus',
            'seq.sequenceId',
            'seq.sequenceNumber',
            'log.logId',
            'log.logNumber',
            'log.type',
          ]),
      )
      .execute();

    await trx.schema
      .createTable('logValue')
      .addColumn('logId', 'integer', (column) => column.notNull())
      .addColumn('name', 'text', (column) => column.notNull())
      .addColumn('value', 'json', (column) => column.notNull())
      .addForeignKeyConstraint('ForeignLogValuelogId', ['logId'], 'log', [
        'logId',
      ])
      .addPrimaryKeyConstraint('logValuePrimaryKey', ['logId', 'name'])
      .execute();
    await sql`
      CREATE TRIGGER prevent_log_value_update
      BEFORE UPDATE ON log_value
      BEGIN
        SELECT RAISE(ABORT, 'Cannot update existing log value');
      END;
    `.execute(trx);
    await sql`
      CREATE TRIGGER prevent_log_value_delete
      BEFORE DELETE ON log_value
      BEGIN
        SELECT RAISE(ABORT, 'Cannot delete existing log value');
      END;
    `.execute(trx);

    const now = new Date().toISOString();
    await trx
      .insertInto('run')
      .columns(['runName', 'experimentName', 'runStatus', 'runCreatedAt'])
      .expression((eb) =>
        eb
          .selectFrom('runOld as old')
          .select([
            'old.runId as runName',
            'old.experimentId as experimentName',
            'old.status as runStatus',
            sql`${now}`.as('runCreatedAt'),
          ]),
      )
      .execute();
    await trx
      .insertInto('logSequence')
      .columns(['sequenceId', 'runId', 'sequenceNumber', 'start'])
      .expression((eb) =>
        eb
          .selectFrom('logSequenceOld as old')
          .innerJoin('run', (join) =>
            join
              .onRef('run.runName', '=', 'old.runId')
              .onRef('run.experimentName', '=', 'old.experimentId'),
          )
          .select([
            'old.sequenceId as sequenceId',
            'run.runId as runId',
            'old.sequenceNumber as sequenceNumber',
            'old.start as start',
          ]),
      )
      .execute();
    await trx
      .insertInto('log')
      .columns(['logId', 'sequenceId', 'logNumber', 'type'])
      .expression((eb) =>
        eb
          .selectFrom('logOld as old')
          .select([
            'old.logId as logId',
            'old.sequenceId as sequenceId',
            'old.logNumber as logNumber',
            'old.type as type',
          ]),
      )
      .execute();
    await trx
      .insertInto('logValue')
      .columns(['logId', 'name', 'value'])
      .expression((eb) =>
        eb
          .selectFrom('logValueOld as old')
          .select([
            'old.logId as logId',
            'old.name as name',
            'old.value as value',
          ]),
      )
      .execute();

    await trx.schema.dropTable('logValueOld').execute();
    await trx.schema.dropTable('logOld').execute();
    await trx.schema.dropTable('logSequenceOld').execute();
    await trx.schema.dropTable('runOld').execute();
  });
}
