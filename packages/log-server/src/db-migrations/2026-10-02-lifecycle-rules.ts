import { Kysely, sql } from 'kysely';
import type { Database as PreviousDatabase } from './2026-10-01-sessions.ts';

export type Database = PreviousDatabase;

// The run lifecycle rules (which status can follow which, when logs are
// accepted) moved out of the database into the server, and the database keeps
// only the rules protecting its own data: run names stay unique among runs that
// are not canceled. A trigger only covered inserts, the index also covers a
// canceled run coming back.
//
// Kysely treats SQLite DDL as non-transactional, so the migration owns its
// transaction: a failure rolls everything back.
export async function up(db: Kysely<Database>) {
  await db.transaction().execute(async (trx) => {
    const duplicates = await trx
      .selectFrom('run')
      .where('runName', 'is not', null)
      .where('runStatus', '<>', 'canceled')
      .groupBy(['experimentId', 'runName'])
      .having((eb) => eb.fn.countAll(), '>', 1)
      .select((eb) => [
        'experimentId',
        'runName',
        eb.fn.agg<string>('group_concat', ['runId']).as('runIds'),
      ])
      .orderBy('experimentId')
      .orderBy('runName')
      .execute();
    if (duplicates.length > 0) {
      const list = duplicates
        .map(
          (d) =>
            `runs ${d.runIds} (experiment ${d.experimentId}, name "${d.runName}")`,
        )
        .join('; ');
      throw new Error(
        `Cannot migrate: some runs share a name with another run of their experiment that is not canceled: ${list}. ` +
          `Fix these runs by hand, then migrate again.`,
      );
    }

    await sql`DROP TRIGGER prevent_run_insert`.execute(trx);
    await sql`DROP TRIGGER prevent_canceled_run_status_update`.execute(trx);
    await sql`DROP TRIGGER prevent_completed_run_status_update`.execute(trx);
    await sql`DROP TRIGGER prevent_non_running_run_log_insert`.execute(trx);

    // Runs without a name never collide: a unique index treats each NULL as
    // different from every other value, so it needs no `run_name IS NOT NULL`.
    await sql`
      CREATE UNIQUE INDEX unique_not_canceled_run_name
      ON run (experiment_id, run_name)
      WHERE run_status <> 'canceled'
    `.execute(trx);
  });
}

export async function down(db: Kysely<Database>) {
  await db.transaction().execute(async (trx) => {
    await sql`DROP INDEX unique_not_canceled_run_name`.execute(trx);

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
  });
}
