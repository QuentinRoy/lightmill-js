import {
  type ColumnType,
  type GeneratedAlways,
  Kysely,
  sql,
  type Transaction,
} from 'kysely';
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
  canceledBy?: ColumnType<number, never, never>;
  logType: ColumnType<string, string, never>;
  logValues: ColumnType<JsonObject, JsonObject, never>;
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
  logType: ColumnType<string, never, never>;
  logValues: ColumnType<JsonObject, never, never>;
};
export type LogPropertyNameTable = {
  logId: ColumnType<DbLogId, number, never>;
  logPropertyName: ColumnType<string, string, never>;
};
// One row per range of missing log numbers in a sequence.
export type LogGapTable = {
  sequenceId: ColumnType<DbLogSequenceId, DbLogSequenceId, never>;
  first: ColumnType<number, number, never>;
  last: ColumnType<number, number, never>;
};
// The last sequence of each run, with the log numbers it defines.
export type LastLogSequenceView = {
  runId: ColumnType<DbRunId, never, never>;
  sequenceId: ColumnType<DbLogSequenceId, never, never>;
  sequenceNumber: ColumnType<number, never, never>;
  start: ColumnType<number, never, never>;
  firstMissingLogNumber: ColumnType<number | null, never, never>;
  lastLogNumber: ColumnType<number, never, never>;
};
export type Database = {
  experiment: ExperimentTable;
  run: RunTable;
  logSequence: LogSequenceTable;
  log: LogTable;
  runLogView: RunLogView;
  logPropertyName: LogPropertyNameTable;
  logGap: LogGapTable;
  lastLogSequenceView: LastLogSequenceView;
};

// The previous schema stores one row per missing log number, so down
// refuses to restore more than this many.
const MAX_RESTORED_MISSING_LOG_NUMBERS = 1_000_000;

// A log row as stored during the table rebuild, including the previous
// schema's rows without a type, which stand for missing log numbers.
type RebuiltLogTable = {
  logId: number;
  sequenceId: number;
  logNumber: number;
  logType: string | null;
  logValues: JsonObject | null;
  canceledBy: number | null;
};
type MigrationTransaction = Transaction<
  Database & { logNew: RebuiltLogTable; logOld: RebuiltLogTable }
>;
const logColumns = [
  'logId',
  'sequenceId',
  'logNumber',
  'logType',
  'logValues',
  'canceledBy',
] as const;

export async function up(db: Kysely<Database>) {
  await withRebuiltLogTables(db).execute(async (trx) => {
    await checkOlderSequencesHaveNoMissingLogs(trx);

    await trx.schema
      .createTable('logGap')
      .addColumn('sequenceId', 'integer', (column) =>
        column.notNull().references('logSequence.sequenceId'),
      )
      .addColumn('first', 'integer', (column) => column.notNull())
      .addColumn('last', 'integer', (column) => column.notNull())
      .addPrimaryKeyConstraint('logGapPrimaryKey', ['sequenceId', 'first'])
      .addCheckConstraint('logGapRangeCheck', sql`first <= last`)
      .modifyEnd(sql`strict, without rowid`)
      .execute();

    // Rows without a type are exactly the missing log numbers, and only the
    // last sequence of each run holds uncanceled ones. Consecutive numbers
    // share the same log_number - ROW_NUMBER(), so each group is one range.
    await trx
      .insertInto('logGap')
      .columns(['sequenceId', 'first', 'last'])
      .expression((eb) =>
        eb
          .selectFrom((eb) =>
            eb
              .selectFrom('log')
              .where('logType', 'is', null)
              .where('canceledBy', 'is', null)
              .where('sequenceId', 'in', selectLastSequenceIds(trx))
              .select((eb) => [
                'sequenceId',
                'logNumber',
                eb(
                  'logNumber',
                  '-',
                  eb.fn
                    .agg<number>('row_number')
                    .over((over) =>
                      over.partitionBy('sequenceId').orderBy('logNumber'),
                    ),
                ).as('rangeKey'),
              ])
              .as('missingLogNumber'),
          )
          .select((eb) => [
            'missingLogNumber.sequenceId',
            eb.fn.min('missingLogNumber.logNumber').as('first'),
            eb.fn.max('missingLogNumber.logNumber').as('last'),
          ])
          .groupBy([
            'missingLogNumber.sequenceId',
            'missingLogNumber.rangeKey',
          ]),
      )
      .execute();

    // SQLite cannot rename a table while triggers or views on other tables
    // reference the one it replaces, so they are recreated after.
    await dropLogDependents(trx);
    await createLogTable(trx, 'logNew', { nullableTypeAndValues: false });
    await trx
      .insertInto('logNew')
      .columns(logColumns)
      .expression((eb) =>
        eb
          .selectFrom('log')
          .where('logType', 'is not', null)
          .select(logColumns),
      )
      .execute();
    await trx.schema.dropTable('log').execute();
    await trx.schema.alterTable('logNew').renameTo('log').execute();

    await trx.schema
      .createIndex('logSequenceTypeNumber')
      .on('log')
      .columns(['sequenceId', 'logType', 'logNumber'])
      .execute();

    // Only canceling a log is allowed.
    await sql`
      CREATE TRIGGER prevent_log_update
      BEFORE UPDATE ON log
      WHEN OLD.canceled_by IS NOT NULL
        OR NEW.log_id IS NOT OLD.log_id
        OR NEW.sequence_id IS NOT OLD.sequence_id
        OR NEW.log_number IS NOT OLD.log_number
        OR NEW.log_type IS NOT OLD.log_type
        OR NEW.log_values IS NOT OLD.log_values
      BEGIN
        SELECT RAISE(ABORT, 'Cannot update logs other than to cancel them');
      END
    `.execute(trx);
    await createLogInsertAndDeleteTriggers(trx);
    await createMarkCanceledLogsTrigger(trx);

    // A log above the highest one opens a gap behind it. The first check
    // skips the common in-order case with one index probe.
    await sql`
      CREATE TRIGGER open_log_gap
      AFTER INSERT ON log
      WHEN NOT EXISTS (
        SELECT 1 FROM log
        WHERE sequence_id = NEW.sequence_id AND log_number = NEW.log_number - 1
      ) AND NOT EXISTS (
        SELECT 1 FROM log
        WHERE sequence_id = NEW.sequence_id AND log_number > NEW.log_number
      )
      BEGIN
        INSERT INTO log_gap (sequence_id, first, last)
        SELECT NEW.sequence_id, previous_log_number + 1, NEW.log_number - 1
        FROM (
          SELECT COALESCE(
            (
              SELECT MAX(log_number) FROM log
              WHERE sequence_id = NEW.sequence_id
                AND log_number < NEW.log_number
            ),
            (SELECT start - 1 FROM log_sequence WHERE sequence_id = NEW.sequence_id)
          ) AS previous_log_number
        )
        WHERE previous_log_number + 1 < NEW.log_number;
      END
    `.execute(trx);

    // A log inside a gap shrinks or splits it. Gaps are disjoint, so the
    // containing gap is the one with the greatest first <= the log number.
    // SQLite triggers can't use WITH, so each statement looks it up again;
    // the primary key makes that one index probe.
    await sql`
      CREATE TRIGGER fill_log_gap
      AFTER INSERT ON log
      WHEN (
        SELECT last FROM log_gap
        WHERE sequence_id = NEW.sequence_id AND first = (
          SELECT MAX(first) FROM log_gap
          WHERE sequence_id = NEW.sequence_id AND first <= NEW.log_number
        )
      ) >= NEW.log_number
      BEGIN
        -- Insert the upper part first: the lookup below still finds the
        -- containing gap because the new row starts above the log number.
        INSERT INTO log_gap (sequence_id, first, last)
        SELECT sequence_id, NEW.log_number + 1, last FROM log_gap
        WHERE sequence_id = NEW.sequence_id
          AND first = (
            SELECT MAX(first) FROM log_gap
            WHERE sequence_id = NEW.sequence_id AND first <= NEW.log_number
          )
          AND last > NEW.log_number;
        UPDATE log_gap SET last = NEW.log_number - 1
        WHERE sequence_id = NEW.sequence_id
          AND first = (
            SELECT MAX(first) FROM log_gap
            WHERE sequence_id = NEW.sequence_id AND first <= NEW.log_number
          )
          AND first < NEW.log_number;
        -- A gap starting at the log number has no lower part left.
        DELETE FROM log_gap
        WHERE sequence_id = NEW.sequence_id AND first = NEW.log_number;
      END
    `.execute(trx);

    await createLastLogSequenceView(trx);

    // resumeRun checks this first to report the run and log numbers; the
    // trigger keeps the gap drop below correct whatever writes the sequence.
    await sql`
      CREATE TRIGGER prevent_resume_after_missing_log
      BEFORE INSERT ON log_sequence
      WHEN NEW.start - 1 > (
        SELECT last_log_number FROM last_log_sequence_view
        WHERE run_id = NEW.run_id
      )
      BEGIN
        SELECT RAISE(ABORT, 'Cannot resume a run after its last log number');
      END
    `.execute(trx);

    // A resume starts at or before the first missing log number, so every
    // gap of the run's older sequences is canceled.
    await sql`
      CREATE TRIGGER drop_log_gaps_on_sequence_insert
      AFTER INSERT ON log_sequence
      BEGIN
        DELETE FROM log_gap WHERE sequence_id IN (
          SELECT sequence_id FROM log_sequence
          WHERE run_id = NEW.run_id AND sequence_id <> NEW.sequence_id
        );
      END
    `.execute(trx);

    await createRunLogView(trx);
  });
}

export async function down(db: Kysely<Database>) {
  await withRebuiltLogTables(db).execute(async (trx) => {
    const { total } = await trx
      .selectFrom('logGap')
      .select((eb) =>
        eb.fn
          .sum<number | null>(eb(eb('last', '-', eb.ref('first')), '+', 1))
          .as('total'),
      )
      .executeTakeFirstOrThrow();
    if (total != null && total > MAX_RESTORED_MISSING_LOG_NUMBERS) {
      const largestGaps = await trx
        .selectFrom('logGap as gap')
        .innerJoin(
          'logSequence as sequence',
          'sequence.sequenceId',
          'gap.sequenceId',
        )
        .select(['sequence.runId', 'gap.first', 'gap.last'])
        .orderBy((eb) => eb('gap.last', '-', eb.ref('gap.first')), 'desc')
        .limit(10)
        .execute();
      const gapList = largestGaps
        .map((gap) => `run ${gap.runId}: ${gap.first} to ${gap.last}`)
        .join(', ');
      throw new Error(
        `Cannot revert: runs are missing ${total} log numbers, and the previous schema stores one row per missing log number (at most ${MAX_RESTORED_MISSING_LOG_NUMBERS}). ` +
          `The largest gaps are ${gapList}. Cancel these runs first.`,
      );
    }

    await sql`DROP TRIGGER drop_log_gaps_on_sequence_insert`.execute(trx);
    await sql`DROP TRIGGER prevent_resume_after_missing_log`.execute(trx);
    await trx.schema.dropView('lastLogSequenceView').execute();
    await dropLogDependents(trx);
    await createLogTable(trx, 'logOld', { nullableTypeAndValues: true });
    await trx
      .insertInto('logOld')
      .columns(logColumns)
      .expression((eb) => eb.selectFrom('log').select(logColumns))
      .execute();
    await trx
      .withRecursive('missingLogNumber(sequenceId, logNumber, last)', (db) =>
        db
          .selectFrom('logGap')
          .select(['sequenceId', 'first as logNumber', 'last'])
          .unionAll((db) =>
            db
              .selectFrom('missingLogNumber')
              .whereRef('logNumber', '<', 'last')
              .select((eb) => [
                'sequenceId',
                eb('logNumber', '+', 1).as('logNumber'),
                'last',
              ]),
          ),
      )
      .insertInto('logOld')
      .columns(['sequenceId', 'logNumber'])
      .expression((eb) =>
        eb.selectFrom('missingLogNumber').select(['sequenceId', 'logNumber']),
      )
      .execute();
    await trx.schema.dropTable('log').execute();
    await trx.schema.alterTable('logOld').renameTo('log').execute();
    await trx.schema.dropTable('logGap').execute();

    await trx.schema
      .createIndex('logSequenceIdTypeNumberIndex')
      .on('log')
      .columns(['sequenceId', 'logType', 'logNumber'])
      .execute();
    await sql`
          CREATE TRIGGER prevent_update_log_info
          BEFORE UPDATE ON log
          WHEN (
            -- Whatever happens, log_number and log_id cannot change.
            OLD.log_number <> NEW.log_number
            OR OLD.log_id <> NEW.log_id
          )
          BEGIN
            SELECT RAISE(ABORT, 'Cannot change log number or log id');
          END;
        `.execute(trx);
    await sql`
          CREATE TRIGGER prevent_changing_log_canceled_by
          BEFORE UPDATE ON log
          WHEN OLD.canceled_by IS NOT NULL and NEW.canceled_by <> OLD.canceled_by
          BEGIN
            SELECT RAISE(ABORT, 'Cannot change log canceled_by once set');
          END;
        `.execute(trx);
    await sql`
          CREATE TRIGGER prevent_changing_log_value
          BEFORE UPDATE ON log
          -- Note: this may be rather expensive, fortunately it shouldn't happen often.
          WHEN OLD.log_values IS NOT NULL AND NEW.log_values <> OLD.log_values
          BEGIN
            SELECT RAISE(ABORT, 'Cannot change log values once set');
          END;
        `.execute(trx);
    await sql`
          CREATE TRIGGER prevent_changing_log_type
          BEFORE UPDATE ON log
          WHEN OLD.log_type IS NOT NULL AND NEW.log_type <> OLD.log_type
          BEGIN
            SELECT RAISE(ABORT, 'Cannot change log type once set');
          END;
        `.execute(trx);
    await createLogInsertAndDeleteTriggers(trx);
    await createMarkCanceledLogsTrigger(trx);
    await trx.schema
      .createIndex('logSequenceTypeNumber')
      .on('log')
      .columns(['sequenceId', 'logType', 'logNumber'])
      .execute();
    await createRunLogView(trx);
  });
}

function withRebuiltLogTables(db: Kysely<Database>) {
  return db
    .withTables<{ logNew: RebuiltLogTable; logOld: RebuiltLogTable }>()
    .transaction();
}

function selectLastSequenceIds(trx: MigrationTransaction) {
  return trx
    .selectFrom('logSequence as sequence')
    .where((eb) =>
      eb(
        'sequence.sequenceNumber',
        '=',
        eb
          .selectFrom('logSequence as runSequence')
          .whereRef('runSequence.runId', '=', 'sequence.runId')
          .select((eb) =>
            eb.fn.max('runSequence.sequenceNumber').as('lastSequenceNumber'),
          ),
      ),
    )
    .select('sequence.sequenceId');
}

// The resume guard implies every missing log number in an older sequence
// was canceled by a later resume. Data breaking it can't be converted.
async function checkOlderSequencesHaveNoMissingLogs(trx: MigrationTransaction) {
  const rows = await trx
    .selectFrom('log')
    .innerJoin(
      'logSequence as sequence',
      'sequence.sequenceId',
      'log.sequenceId',
    )
    .where('log.logType', 'is', null)
    .where('log.canceledBy', 'is', null)
    .where('log.sequenceId', 'not in', selectLastSequenceIds(trx))
    .select('sequence.runId')
    .distinct()
    .orderBy('sequence.runId')
    .execute();
  if (rows.length > 0) {
    throw new Error(
      `Cannot migrate: runs ${rows.map((row) => row.runId).join(', ')} have missing log numbers that were not canceled in a sequence before their last one. ` +
        `Fix these runs by hand, then migrate again.`,
    );
  }
}

async function dropLogDependents(trx: MigrationTransaction) {
  await trx.schema.dropView('runLogView').execute();
  await sql`DROP TRIGGER mark_canceled_logs_on_sequence_insert`.execute(trx);
}

async function createLogTable(
  trx: MigrationTransaction,
  name: 'logNew' | 'logOld',
  { nullableTypeAndValues }: { nullableTypeAndValues: boolean },
) {
  await trx.schema
    .createTable(name)
    .addColumn('logId', 'integer', (column) => column.primaryKey())
    .addColumn('sequenceId', 'integer', (column) => column.notNull())
    .addColumn('logNumber', 'integer', (column) => column.notNull())
    .addColumn('logType', 'text', (column) =>
      nullableTypeAndValues ? column : column.notNull(),
    )
    .addColumn('logValues', 'blob', (column) =>
      nullableTypeAndValues ? column : column.notNull(),
    )
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
}

async function createLogInsertAndDeleteTriggers(trx: MigrationTransaction) {
  await sql`
          CREATE TRIGGER prevent_log_delete
          BEFORE DELETE ON log
          BEGIN
            SELECT RAISE(ABORT, 'Cannot delete logs');
          END;
        `.execute(trx);
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
}

async function createMarkCanceledLogsTrigger(trx: MigrationTransaction) {
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
}

async function createRunLogView(trx: MigrationTransaction) {
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
          'seq.sequenceId',
          'log.logId',
          'log.logNumber',
          'log.logType',
          'log.logValues',
        ]),
    )
    .execute();
}

async function createLastLogSequenceView(trx: MigrationTransaction) {
  await trx.schema
    .createView('lastLogSequenceView')
    .as(
      trx
        .selectFrom('logSequence as sequence')
        .where((eb) =>
          eb(
            'sequence.sequenceNumber',
            '=',
            eb
              .selectFrom('logSequence as runSequence')
              .whereRef('runSequence.runId', '=', 'sequence.runId')
              .select((eb) =>
                eb.fn
                  .max('runSequence.sequenceNumber')
                  .as('lastSequenceNumber'),
              ),
          ),
        )
        .select((eb) => {
          const firstMissingLogNumber = eb
            .selectFrom('logGap')
            .whereRef('logGap.sequenceId', '=', 'sequence.sequenceId')
            .select((eb) => eb.fn.min('logGap.first').as('first'));
          const maxLogNumber = eb
            .selectFrom('log')
            .whereRef('log.sequenceId', '=', 'sequence.sequenceId')
            .select((eb) => eb.fn.max('log.logNumber').as('logNumber'));
          return [
            'sequence.runId',
            'sequence.sequenceId',
            'sequence.sequenceNumber',
            'sequence.start',
            firstMissingLogNumber.as('firstMissingLogNumber'),
            // Older sequences have no gaps, and every number below the last
            // sequence's start is present, so the last sequence is enough.
            eb.fn
              .coalesce(
                eb(firstMissingLogNumber, '-', 1),
                maxLogNumber,
                eb('sequence.start', '-', 1),
              )
              .as('lastLogNumber'),
          ];
        }),
    )
    .execute();
}
