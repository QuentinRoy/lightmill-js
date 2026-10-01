import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import * as url from 'node:url';
import { expect, it } from 'vitest';
import { apiMediaType } from '../src/api.ts';
import { SQLiteDataStore } from '../src/sqlite-data-store.ts';

const packageDir = url.fileURLToPath(new URL('..', import.meta.url));
const cliPath = path.join(packageDir, 'dist', 'cli.js');

async function unusedPort(): Promise<number> {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address == null || typeof address === 'string') {
    throw new Error('Could not allocate a test port');
  }
  const port = address.port;
  server.close();
  await once(server, 'close');
  return port;
}

async function startServer(
  database: string,
  port: number,
): Promise<ChildProcess> {
  const child = spawn(
    process.execPath,
    [
      cliPath,
      'start',
      '--database',
      database,
      '--port',
      String(port),
      '--session-key',
      'test-session-key',
      '--session-max-age-days',
      '7',
      '--same-origin',
    ],
    { stdio: 'pipe', env: { ...process.env, NODE_ENV: 'production' } },
  );
  const url = `http://127.0.0.1:${port}/sessions/current`;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) {
      throw new Error(`CLI exited before becoming ready: ${child.exitCode}`);
    }
    try {
      const response = await fetch(url);
      if (response.status === 404) return child;
    } catch {
      // The server has not started listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  child.kill('SIGTERM');
  throw new Error('CLI did not become ready');
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
  const port = await unusedPort();
  const baseUrl = `http://127.0.0.1:${port}`;
  let child: ChildProcess | undefined;
  try {
    child = await startServer(database, port);
    const response = await fetch(`${baseUrl}/sessions`, {
      method: 'POST',
      headers: { 'content-type': apiMediaType },
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
    child = await startServer(database, port);
    const restored = await fetch(`${baseUrl}/sessions/current`, {
      headers: { cookie: cookie! },
    });
    expect(restored.status).toBe(200);
    expect((await restored.json()).data.attributes.role).toBe('participant');
  } finally {
    if (child !== undefined) await stopServer(child);
    rmSync(directory, { recursive: true, force: true });
  }
}, 15_000);
