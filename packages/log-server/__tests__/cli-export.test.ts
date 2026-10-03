import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as url from 'node:url';
import { expect, it } from 'vitest';
import { SQLiteDataStore } from '../src/sqlite-data-store.ts';

const cliPath = url.fileURLToPath(new URL('../src/cli.ts', import.meta.url));

it('exports only logs with the requested type', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'lightmill-export-'));
  const database = path.join(directory, 'data.sqlite');

  try {
    await SQLiteDataStore.migrateDatabase(database);
    const store = await SQLiteDataStore.open(database);
    try {
      await store.withTransaction(async (tx) => {
        const { experimentId } = await tx.addExperiment({
          experimentName: 'test experiment',
        });
        const { runId } = await tx.addRun({ experimentId });
        await tx.setRunStatus(runId, 'running');
        await tx.addLogs(runId, [
          { type: 'requested', number: 1, values: { value: 'included' } },
          { type: 'other', number: 2, values: { value: 'excluded' } },
        ]);
      });
    } finally {
      await store.close();
    }

    const result = spawnSync(
      process.execPath,
      [cliPath, 'export', '--database', database, '--logType', 'requested'],
      { encoding: 'utf8' },
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('included');
    expect(result.stdout).not.toContain('excluded');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
