import { ColumnType, GeneratedAlways, Kysely, sql } from 'kysely';

// We use ColumnType to prevent the column from being updated.
type RunTable = {
  runId: ColumnType<string, string, never>;
  experimentId: ColumnType<string, string, never>;
  status: 'running' | 'completed' | 'canceled';
};
type LogSequenceTable = {
  sequenceId: GeneratedAlways<number>;
  experimentId: ColumnType<string, string, never>;
  runId: ColumnType<string, string, never>;
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
  logId: ColumnType<number, never, never>;
  experimentId: ColumnType<string, never, never>;
  runId: ColumnType<string, never, never>;
  sequenceId: ColumnType<number, never, never>;
  logNumber: ColumnType<number, never, never>;
  sequenceNumber: ColumnType<number, never, never>;
  // Logs with no types are used to fill in missing log numbers.
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

export async function up(db: Kysely<Database>) {
  await db.transaction().execute(async (trx) => {
    await trx.schema
      .createTable('run')
      .addColumn('runId', 'text', (column) => column.notNull())
      .addColumn('experimentId', 'text', (column) => column.notNull())
      .addColumn('status', 'text', (column) => column.notNull())
      .addCheckConstraint(
        'RunStatusCheck',
        sql`status IN ('running', 'completed', 'canceled')`,
      )
      .addPrimaryKeyConstraint('runPrimaryKey', ['experimentId', 'runId'])
      .execute();

    await trx.schema
      .createTable('logSequence')
      .addColumn('sequenceId', 'integer', (column) => column.primaryKey())
      .addColumn('experimentId', 'text', (column) => column.notNull())
      .addColumn('runId', 'text', (column) => column.notNull())
      .addColumn('sequenceNumber', 'integer', (column) =>
        column.notNull().check(sql`sequence_number > 0`),
      )
      .addColumn('start', 'integer', (column) =>
        // Make sure that the start number is greater than zero.
        column.notNull().check(sql`start > 0`),
      )
      // This creates an index on the columns (so no need to create another) and
      // prevents duplicate rows.
      .addUniqueConstraint('logSequenceUnique', [
        'experimentId',
        'runId',
        'sequenceNumber',
      ])
      .addForeignKeyConstraint(
        'ForeignLogSequenceRun',
        ['experimentId', 'runId'],
        'run',
        ['experimentId', 'runId'],
      )
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
        SELECT RAISE(ABORT, 'Cannot update existing log');
      END;
    `.execute(trx);
    // Prevent deletion of log rows whose current type column is not null.
    await sql`
      CREATE TRIGGER prevent_log_delete
      BEFORE DELETE ON log
      WHEN OLD.type IS NOT NULL
      BEGIN
        SELECT RAISE(ABORT, 'Cannot delete existing log');
      END;
    `.execute(trx);
    // Prevent inserts of log whose number is smaller than its sequence start.
    await sql`
      CREATE TRIGGER prevent_log_insert
      BEFORE INSERT ON log
      WHEN NEW.log_number < (
        SELECT start FROM log_sequence WHERE sequence_id = NEW.sequence_id
      )
      BEGIN
        SELECT RAISE(ABORT, 'Cannot insert log with log_number smaller than its sequence start');
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
                    .select([
                      'experimentId',
                      'runId',
                      'sequenceNumber',
                      'start',
                    ])
                    .as('nextSeq'),
                (join) =>
                  join
                    .onRef('nextSeq.experimentId', '=', 'seq.experimentId')
                    .onRef('nextSeq.runId', '=', 'seq.runId')
                    .onRef('nextSeq.sequenceNumber', '>', 'seq.sequenceNumber'),
              )
              .groupBy(['seq.sequenceId'])
              .select((eb) => [
                'seq.sequenceId',
                'seq.experimentId',
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
          .select([
            'log.logId',
            'seq.experimentId',
            'seq.runId',
            'seq.sequenceId',
            'seq.sequenceNumber',
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
    await trx.schema
      .createIndex('logValueLogIdName')
      .on('logValue')
      .columns(['logId', 'name'])
      .execute();
  });
}
