import { Kysely } from 'kysely';

export async function up(
  db: Kysely<{ log: { clientDate: Date; createdAt?: Date } }>,
) {
  await db.transaction().execute(async (trx) => {
    await trx.schema.dropIndex('logSort').execute();

    await trx.schema
      .createIndex('logSort')
      .on('log')
      .columns([
        'experimentId',
        'runId',
        'clientDate',
        'createdAt',
        'batchOrder',
      ])
      .execute();
  });
}

export async function down(db: Kysely<unknown>) {
  await db.transaction().execute(async (trx) => {
    await trx.schema.dropIndex('logSort').execute();
    await trx.schema
      .createIndex('logSort')
      .on('log')
      .columns([
        'experimentId',
        'runId',
        'type',
        'clientDate',
        'createdAt',
        'batchOrder',
      ])
      .execute();
  });
}
