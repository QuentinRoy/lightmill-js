import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as url from 'node:url';
import { expect, it } from 'vitest';
import { SQLiteDataStore } from '../src/sqlite-data-store.ts';

const cliPath = url.fileURLToPath(new URL('../src/cli.ts', import.meta.url));

it('creates an experiment in a new database and reports duplicate names', async () => {
  const directory = mkdtempSync(
    path.join(os.tmpdir(), 'lightmill-experiment-'),
  );
  const database = path.join(directory, 'data.sqlite');
  const args = [
    cliPath,
    'experiment',
    'add',
    'test experiment',
    '--database',
    database,
  ];

  try {
    const created = spawnSync(process.execPath, args, { encoding: 'utf8' });
    expect(created.status).toBe(0);
    expect(created.stderr).toBe('');

    const store = await SQLiteDataStore.open(database);
    try {
      const experiments = await store.getExperiments();
      expect(experiments.map(({ experimentName }) => experimentName)).toEqual([
        'test experiment',
      ]);
    } finally {
      await store.close();
    }

    const duplicate = spawnSync(process.execPath, args, { encoding: 'utf8' });
    expect(duplicate.status).toBe(1);
    expect(duplicate.stderr).toContain(
      'An experiment named "test experiment" already exists. Choose a different name.',
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

it('rejects an empty experiment name without creating it', () => {
  const directory = mkdtempSync(
    path.join(os.tmpdir(), 'lightmill-experiment-'),
  );
  const database = path.join(directory, 'data.sqlite');
  try {
    const result = spawnSync(
      process.execPath,
      [cliPath, 'experiment', 'add', '', '--database', database],
      { encoding: 'utf8' },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('The experiment name cannot be empty.');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
