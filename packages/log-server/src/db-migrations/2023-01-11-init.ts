import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>) {
  await db.transaction().execute(async (trx) => {
    await trx.schema
      .createTable('run')
      .addColumn('experimentId', 'text', (column) => column.notNull())
      .addColumn('runId', 'text', (column) => column.notNull())
      .addPrimaryKeyConstraint('runRunIdExperimentIdPk', [
        'experimentId',
        'runId',
      ])
      .addColumn('createdAt', 'datetime', (column) => column.notNull())
      .addColumn('status', 'text', (column) => column.notNull())
      .addCheckConstraint(
        'statusCheck',
        sql`status IN ('running', 'completed', 'canceled')`,
      )
      .execute();

    await trx.schema
      .createTable('log')
      .addColumn('logId', 'integer', (column) => column.primaryKey())
      .addColumn('experimentId', 'text', (column) => column.notNull())
      .addColumn('runId', 'text', (column) => column.notNull())
      .addColumn('type', 'text', (column) => column.notNull())
      // It is possible to set up the foreign key constraint in addColumn but
      // some databases, like MySQL, need the constraint to be defined
      // separately.
      .addForeignKeyConstraint(
        'logRunFk',
        ['experimentId', 'runId'],
        'run',
        ['experimentId', 'runId'],
        // This is the default behaviour, but it is good to be explicit.
        (constraint) => constraint.onDelete('restrict'),
      )
      .addColumn('createdAt', 'datetime', (column) => column.notNull())
      .execute();

    await trx.schema
      .createIndex('logExperimentRunId')
      .on('log')
      .columns(['experimentId', 'runId'])
      .execute();

    await trx.schema
      .createIndex('logExperimentType')
      .on('log')
      .columns(['experimentId', 'type'])
      .execute();

    await trx.schema
      .createTable('logValue')
      .addColumn('logId', 'integer', (column) => column.notNull())
      .addForeignKeyConstraint(
        'valueRunFk',
        ['logId'],
        'log',
        ['logId'],
        (constraint) => constraint.onDelete('restrict'),
      )
      .addColumn('name', 'text', (column) => column.notNull())
      .addPrimaryKeyConstraint('primaryKey', ['logId', 'name'])
      .addColumn('value', 'json', (column) => column.notNull())
      .execute();

    await trx.schema
      .createIndex('logValueLogId')
      .on('logValue')
      .column('logId')
      .execute();

    await trx.schema
      .createIndex('logValueName')
      .on('logValue')
      .column('name')
      .execute();
  });
}

export async function down(db: Kysely<unknown>) {
  await db.transaction().execute(async (trx) => {
    await trx.schema.dropTable('run').execute();
    await trx.schema.dropTable('log').execute();
    await trx.schema.dropTable('logValue').execute();
  });
}
