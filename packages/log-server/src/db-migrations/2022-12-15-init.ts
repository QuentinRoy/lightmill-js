import { Kysely } from 'kysely';

export async function up(db: Kysely<unknown>) {
  await db.transaction().execute(async (trx) => {
    await trx.schema
      .createTable('run')
      .addColumn('id', 'text', (column) => column.primaryKey().notNull())
      .addColumn('experimentId', 'text')
      .addColumn('createdAt', 'datetime', (column) => column.notNull())
      .addColumn('endedAt', 'datetime')
      .execute();

    await trx.schema
      .createIndex('runExperimentId')
      .on('run')
      .column('experimentId')
      .execute();

    await trx.schema
      .createTable('log')
      .addColumn('id', 'integer', (column) => column.primaryKey())
      .addColumn('type', 'text', (column) => column.notNull())
      .addColumn('runId', 'text', (column) => column.notNull())
      // Some databases (e.g. MySQL) don't support foreign keys on text columns.
      .addForeignKeyConstraint('logRun', ['runId'], 'run', ['id'])
      .addColumn('createdAt', 'datetime', (column) => column.notNull())
      .execute();

    await trx.schema
      .createIndex('logRunId')
      .on('log')
      .column('runId')
      .execute();

    await trx.schema
      .createTable('logValue')
      .addColumn('logId', 'integer', (column) => column.notNull())
      .addForeignKeyConstraint('valueRun', ['logId'], 'log', ['id'])
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
      .createTable('session')
      .addColumn('id', 'text', (column) => column.notNull().primaryKey())
      .addColumn('runId', 'text', (column) => column.notNull())
      .addColumn('createdAt', 'datetime', (column) => column.notNull())
      .addColumn('expiresAt', 'datetime')
      // Some databases (e.g. MySQL) don't support foreign keys on text columns.
      .addForeignKeyConstraint('sessionRun', ['runId'], 'run', ['id'])
      .addColumn('cookie', 'json', (column) => column.notNull())
      .execute();
  });
}

export async function down(db: Kysely<unknown>) {
  await db.transaction().execute(async (trx) => {
    await trx.schema.dropTable('session').execute();
    await trx.schema.dropTable('log').execute();
    await trx.schema.dropTable('run').execute();
  });
}
