import { mediaType } from '@lightmill/log-api/vocabulary';
import {
  spawn,
  type ChildProcess,
  type ChildProcessWithoutNullStreams,
} from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as url from 'node:url';
import { expect, it } from 'vitest';
import { SQLiteDataStore } from '../src/sqlite-data-store.ts';

const packageDir = url.fileURLToPath(new URL('..', import.meta.url));
const cliPath = path.join(packageDir, 'dist', 'cli.js');

async function startServer(
  database: string,
): Promise<{ child: ChildProcess; port: number }> {
  const child = spawn(
    process.execPath,
    [
      cliPath,
      'start',
      '--database',
      database,
      // Port 0 lets the OS pick a free port when the CLI binds it, so no other
      // process can take it in between.
      '--port',
      '0',
      '--session-key',
      'test-session-key',
      '--session-max-age-days',
      '7',
      '--same-origin',
    ],
    {
      stdio: 'pipe',
      // The "Listening" line is info-level; a LOG_LEVEL inherited from the
      // developer's shell would hide it.
      env: { ...process.env, NODE_ENV: 'production', LOG_LEVEL: 'info' },
    },
  );
  return { child, port: await listeningPort(child) };
}

async function listeningPort(child: ChildProcessWithoutNullStreams) {
  let output = '';
  for await (const chunk of child.stdout) {
    output += String(chunk);
    const match = /Listening on port (\d+)/.exec(output);
    if (match != null) return Number(match[1]);
  }
  throw new Error('CLI exited before listening');
}

async function stopServer(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  await exited;
}

it('CLI sessions and browser cookies survive a restart', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'lightmill-sessions-'));
  const database = path.join(directory, 'data.sqlite');
  await SQLiteDataStore.migrateDatabase(database);
  let child: ChildProcess | undefined;
  try {
    let port: number;
    ({ child, port } = await startServer(database));
    let baseUrl = `http://127.0.0.1:${port}`;
    const response = await fetch(`${baseUrl}/sessions`, {
      method: 'POST',
      headers: { 'content-type': mediaType },
      body: JSON.stringify({
        data: { type: 'sessions', attributes: { role: 'participant' } },
      }),
    });
    expect(response.status).toBe(201);
    const setCookie = response.headers.get('set-cookie');
    expect(setCookie).toContain('Expires=');
    const expires = setCookie?.match(/Expires=([^;]+)/)?.[1];
    expect(expires).toBeDefined();
    const daysUntilExpiry =
      (new Date(expires!).getTime() - Date.now()) / 86_400_000;
    expect(daysUntilExpiry).toBeGreaterThan(6.9);
    expect(daysUntilExpiry).toBeLessThan(7.1);
    const cookie = setCookie?.split(';', 1)[0];
    expect(cookie).toBeTruthy();

    await stopServer(child);
    child = undefined;
    // Cookies are not scoped to a port, so the restart may use a different one.
    ({ child, port } = await startServer(database));
    baseUrl = `http://127.0.0.1:${port}`;
    const restored = await fetch(`${baseUrl}/sessions/current`, {
      headers: { cookie: cookie! },
    });
    expect(restored.status).toBe(200);
    expect(await restored.json()).toMatchObject({
      data: { attributes: { role: 'participant' } },
    });
  } finally {
    if (child !== undefined) await stopServer(child);
    rmSync(directory, { recursive: true, force: true });
  }
}, 15_000);
