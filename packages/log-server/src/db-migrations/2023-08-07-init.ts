import { GeneratedAlways, Kysely, sql } from 'kysely';

type RunTable = {
  runId: string;
  experimentId: string;
  status: 'running' | 'completed' | 'canceled';
};
type LogSequenceTable = {
  id: GeneratedAlways<number>;
  experimentId: string;
  runId: string;
  number: number;
  start: number;
};
type logTable = {
  id: GeneratedAlways<number>;
  logSequenceId: number;
  number: number;
  // Logs with no types are used to fill in missing log numbers.
  type?: string;
};
type RunLogView = {
  id: GeneratedAlways<number>;
  experimentId: string;
  runId: string;
  logSequenceId: number;
  logNumber: number;
  sequenceNumber: number;
  // Logs with no types are used to fill in missing log numbers.
  type?: string;
};
type LogValueTable = {
  logId: number;
  name: string;
  value: string;
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
      .addColumn('id', 'integer', (column) => column.primaryKey())
      .addColumn('experimentId', 'text', (column) => column.notNull())
      .addColumn('runId', 'text', (column) => column.notNull())
      .addColumn('number', 'integer', (column) =>
        column.notNull().check(sql`number > 0`),
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
        'number',
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
      .addColumn('id', 'integer', (column) => column.primaryKey())
      .addColumn('logSequenceId', 'integer', (column) => column.notNull())
      .addColumn('number', 'integer', (column) => column.notNull())
      // Empty means missing log.
      .addColumn('type', 'text')
      // This creates an index on the columns (so no need to create another) and
      // prevents duplicate rows.
      .addUniqueConstraint('UniqueLog', ['logSequenceId', 'number'])
      .addForeignKeyConstraint(
        'ForeignLogSequenceId',
        ['logSequenceId'],
        'logSequence',
        ['id'],
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
      WHEN NEW.number < (
        SELECT start FROM log_sequence WHERE id = NEW.log_sequence_id
      )
      BEGIN
        SELECT RAISE(ABORT, 'Cannot insert log with number smaller than its sequence start');
      END;
    `.execute(trx);

    // There should already be an index to select logs by logSequenceId and
    // number, but we need to create an index to select logs by logSequenceId,
    // type, and number.
    await trx.schema
      .createIndex('logSelectWithType')
      .on('log')
      .columns(['logSequenceId', 'type', 'number'])
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
                    .select(['experimentId', 'runId', 'number', 'start'])
                    .as('nextSeq'),
                (join) =>
                  join
                    .onRef('nextSeq.experimentId', '=', 'seq.experimentId')
                    .onRef('nextSeq.runId', '=', 'seq.runId')
                    .onRef('nextSeq.number', '>', 'seq.number'),
              )
              .groupBy(['seq.id'])
              .select((eb) => [
                'seq.id as id',
                'seq.experimentId',
                'seq.runId',
                'seq.number as number',
                eb.fn.min('nextSeq.start').as('end'),
              ]),
          )
          .selectFrom('log')
          .innerJoin('logSequenceWithEnd as seq', (join) =>
            join.onRef('seq.id', '=', 'log.logSequenceId'),
          )
          .where((eb) =>
            eb.or([
              eb('seq.end', 'is', null),
              eb('log.number', '<', eb.ref('seq.end')),
            ]),
          )
          .select([
            'log.id as id',
            'seq.experimentId',
            'seq.runId',
            'seq.id as logSequenceId',
            'seq.number as sequenceNumber',
            'log.number as logNumber',
            'log.type',
          ]),
      )
      .execute();

    await trx.schema
      .createTable('logValue')
      .addColumn('logId', 'integer', (column) => column.notNull())
      .addColumn('name', 'text', (column) => column.notNull())
      .addColumn('value', 'json', (column) => column.notNull())
      .addForeignKeyConstraint('ForeignLogValuelogId', ['logId'], 'log', ['id'])
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
  });
}
