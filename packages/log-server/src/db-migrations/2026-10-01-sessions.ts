import { Kysely } from 'kysely';
import type { Database as PreviousDatabase } from './2026-09-28-gap-ranges.ts';

export type SessionTable = { sid: string; data: string; expiresAt: number };
export type Database = PreviousDatabase & { lightmillSessions: SessionTable };

// The standalone server used to create this table itself. IF NOT EXISTS leaves
// the table, and its rows, of a database it already ran on untouched.
export async function up(db: Kysely<Database>) {
  await db.schema
    .createTable('lightmillSessions')
    .ifNotExists()
    .addColumn('sid', 'text', (column) => column.primaryKey())
    .addColumn('data', 'text', (column) => column.notNull())
    .addColumn('expiresAt', 'integer', (column) => column.notNull())
    .execute();
  await db.schema
    .createIndex('lightmillSessionsExpiresAt')
    .ifNotExists()
    .on('lightmillSessions')
    .column('expiresAt')
    .execute();
}

export async function down(db: Kysely<Database>) {
  await db.schema.dropIndex('lightmillSessionsExpiresAt').ifExists().execute();
  await db.schema.dropTable('lightmillSessions').ifExists().execute();
}
