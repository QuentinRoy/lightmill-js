import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>) {
  await db.transaction().execute(async (trx) => {
    await trx.schema
      .createTable('run')
      .addColumn('runDbId', 'integer', (column) => column.primaryKey())
      .addColumn('experimentId', 'text', (column) => column.notNull())
      .addColumn('runId', 'text', (column) => column.notNull())
      .addColumn('status', 'text', (column) => column.notNull())
      .addColumn('createdAt', 'datetime')
      .addUniqueConstraint('UniqueRunPerExperiment', ['experimentId', 'runId'])
      .execute();

    await trx.schema
      .createTable('log')
      .addColumn('logDbId', 'integer', (column) => column.primaryKey())
      .addColumn('runDbId', 'integer', (column) => column.notNull())
      .addColumn('type', 'text')
      .addColumn('number', 'integer', (column) => column.notNull())
      .addColumn('createdAt', 'datetime')
      .addForeignKeyConstraint('ForeignLogRunDbId', ['runDbId'], 'run', [
        'runDbId',
      ])
      .addUniqueConstraint('UniqueLogNumberPerRun', ['runDbId', 'number'])
      .execute();
    // Prevents updates of log rows whose current type column is not null.
    await sql`
      CREATE TRIGGER PreventLogTypeUpdate
      BEFORE UPDATE ON log
      FOR EACH ROW
      WHEN OLD.type IS NOT NULL
      BEGIN
        SELECT RAISE(ABORT, 'Cannot update existing log');
      END;
    `.execute(trx);

    await trx.schema
      .createTable('logValue')
      .addColumn('logDbId', 'integer', (column) => column.notNull())
      .addColumn('name', 'text', (column) => column.notNull())
      .addColumn('value', 'json', (column) => column.notNull())
      .addForeignKeyConstraint('ForeignLogValueLogDbId', ['logDbId'], 'log', [
        'logDbId',
      ])
      .addPrimaryKeyConstraint('logValuePrimaryKey', ['logDbId', 'name'])
      .execute();

    await trx.schema
      .createIndex('runSort')
      .on('run')
      .columns(['experimentId', 'runId'])
      .execute();
    await trx.schema
      .createIndex('logSelectWithoutType')
      .on('log')
      .columns(['runDbId', 'number'])
      .execute();
    await trx.schema
      .createIndex('logSelectWithType')
      .on('log')
      .columns(['runDbId', 'type', 'number'])
      .execute();
    await trx.schema
      .createIndex('logValueLogIdName')
      .on('logValue')
      .columns(['logDbId', 'name'])
      .execute();
  });
}
