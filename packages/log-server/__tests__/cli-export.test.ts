import SQLiteDB from 'better-sqlite3';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as url from 'node:url';
import { expect, it } from 'vitest';
import { SQLiteDataStore } from '../src/sqlite-data-store.ts';

const cliPath = url.fileURLToPath(new URL('../src/cli.ts', import.meta.url));

type TestLog = { type: string; number: number; value: string };

async function createDatabase(database: string, logs: TestLog[] = []) {
  await SQLiteDataStore.migrateDatabase(database);
  if (logs.length === 0) return;
  const store = await SQLiteDataStore.open(database);
  try {
    await store.withTransaction(async (tx) => {
      const { experimentId } = await tx.addExperiment({
        experimentName: 'test experiment',
      });
      const { runId } = await tx.addRun({ experimentId });
      await tx.setRunStatus(runId, 'running');
      await tx.addLogs(
        runId,
        logs.map(({ type, number, value }) => ({
          type,
          number,
          values: { value },
        })),
      );
    });
  } finally {
    await store.close();
  }
}

// Log values are stored as jsonb, so an invalid blob makes reading the logs
// fail after the export started, which the data store cannot be made to do.
function makeLogsUnreadable(database: string) {
  const db = new SQLiteDB(database);
  try {
    // A trigger forbids updating logs, so it has to go first.
    db.exec('DROP TRIGGER prevent_log_update');
    db.exec("UPDATE log SET log_values = X'00'");
  } finally {
    db.close();
  }
}

async function withDirectory(
  test: (directory: string, database: string) => Promise<void>,
) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'lightmill-export-'));
  try {
    await test(directory, path.join(directory, 'data.sqlite'));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function runExport(database: string, ...args: string[]) {
  return spawnSync(
    process.execPath,
    [cliPath, 'export', '--database', database, ...args],
    { encoding: 'utf8' },
  );
}

it('exports only logs with the requested type', () =>
  withDirectory(async (_directory, database) => {
    await createDatabase(database, [
      { type: 'requested', number: 1, value: 'included' },
      { type: 'other', number: 2, value: 'excluded' },
    ]);

    const result = runExport(database, '--logType', 'requested');

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('included');
    expect(result.stdout).not.toContain('excluded');
  }));

it('exports to a file when the standard output is not a terminal', () =>
  withDirectory(async (directory, database) => {
    const output = path.join(directory, 'logs.csv');
    await createDatabase(database, [
      { type: 'a', number: 1, value: 'one' },
      { type: 'a', number: 2, value: 'two' },
    ]);

    const result = runExport(database, '--output', output);

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/^2 logs exported in /);
    expect(readFileSync(output, 'utf8')).toBe(
      'type,experiment_name,run_name,run_status,value\n' +
        'a,test experiment,,running,one\n' +
        'a,test experiment,,running,two\n',
    );
  }));

it('reports 0 logs when there is nothing to export', () =>
  withDirectory(async (directory, database) => {
    await createDatabase(database);

    const result = runExport(
      database,
      '--output',
      path.join(directory, 'logs.csv'),
    );

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/^0 logs exported in /);
  }));

it('reports a failed read and keeps the existing output file', () =>
  withDirectory(async (directory, database) => {
    const output = path.join(directory, 'logs.csv');
    await createDatabase(database, [{ type: 'a', number: 1, value: 'one' }]);
    makeLogsUnreadable(database);
    writeFileSync(output, 'previous export');

    const result = runExport(database, '--output', output);

    expect(result.status).toBe(1);
    expect(result.stderr).not.toBe('');
    expect(result.stdout).not.toContain('logs exported');
    expect(readFileSync(output, 'utf8')).toBe('previous export');
    expect(readdirSync(directory).sort()).toEqual(['data.sqlite', 'logs.csv']);
  }));

it('reports a failed read when exporting to the standard output', () =>
  withDirectory(async (_directory, database) => {
    await createDatabase(database, [{ type: 'a', number: 1, value: 'one' }]);
    makeLogsUnreadable(database);

    const result = runExport(database);

    expect(result.status).toBe(1);
    expect(result.stderr).not.toBe('');
  }));

it('removes the temporary file when the output cannot be replaced', () =>
  withDirectory(async (directory, database) => {
    const output = path.join(directory, 'logs.csv');
    await createDatabase(database);
    // A non-empty directory cannot be replaced by a file.
    mkdirSync(output);
    writeFileSync(path.join(output, 'keep'), '');

    const result = runExport(database, '--output', output);

    expect(result.status).toBe(1);
    expect(result.stdout).not.toContain('logs exported');
    expect(readdirSync(directory).sort()).toEqual(['data.sqlite', 'logs.csv']);
  }));
