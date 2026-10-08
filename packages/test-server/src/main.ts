import { createLogServer, SQLiteDataStore } from '@lightmill/log-server';
import express from 'express';
import { setupServer, type SetupServer } from 'msw/node';
import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import { CookieJar } from 'tough-cookie';
import { test, vi } from 'vitest';

type Operation = {
  data: { attributes: { number: number; values: Record<string, unknown> } };
};

export function parseOperations(body: string): Operation[] {
  return JSON.parse(body)['atomic:operations'];
}

/**
 * A real log server on an in-memory database, listening on a free local port.
 *
 * Tests reach it through `fetch` like a browser would, with a cookie jar that
 * is as strict as a browser's about credentials. MSW sits in front of it, but
 * lets requests through unless a test registers a handler with `msw.use()`:
 * that is how tests inject faults the server would never produce.
 */
export class TestServer {
  readonly apiRoot: string;
  readonly dataStore: SQLiteDataStore;
  readonly msw: SetupServer;
  #http: Server;
  #requests: Array<{ method: string; path: string; body: Promise<string> }> =
    [];

  private constructor(
    http: Server,
    dataStore: SQLiteDataStore,
    msw: SetupServer,
  ) {
    this.#http = http;
    this.dataStore = dataStore;
    this.msw = msw;
    const address = http.address();
    if (address == null || typeof address === 'string') {
      throw new TypeError('The server must listen on a TCP port');
    }
    this.apiRoot = `http://127.0.0.1:${address.port}`;
    msw.events.on('request:start', ({ request }) => {
      // Interceptors are global: a client left running by an earlier test
      // reaches this server's listener too.
      if (new URL(request.url).origin !== this.apiRoot) return;
      // The body is a stream the server consumes, so it is read from a clone.
      this.#requests.push({
        method: request.method,
        path: new URL(request.url).pathname,
        body: request.clone().text(),
      });
    });
  }

  static async start() {
    const dataStore = await SQLiteDataStore.open(':memory:');
    const { middleware } = createLogServer({
      dataStore,
      sessionKeys: ['test-secret'],
      cookieSite: 'same-site',
      secureCookies: 'never',
      hostPassword: 'test-host-password',
    });
    const http = createServer(express().use(middleware));
    // Not `localhost`, which may resolve to an address another process holds.
    http.listen(0, '127.0.0.1');
    await once(http, 'listening');
    const msw = setupServer();
    msw.listen({ onUnhandledFrame: 'bypass' });
    stubFetchWithCookieJar();
    return new TestServer(http, dataStore, msw);
  }

  async stop() {
    this.msw.close();
    vi.unstubAllGlobals();
    this.#http.closeAllConnections();
    this.#http.close();
    await this.dataStore.close();
  }

  url(path: string) {
    return `${this.apiRoot}${path}`;
  }

  async addExperiment(experimentName: string): Promise<void> {
    await this.dataStore.withTransaction(async (tx) => {
      await tx.addExperiment({ experimentName });
    });
  }

  async storedRuns() {
    return (await this.dataStore.getRuns()).map(({ runName, runStatus }) => ({
      runName,
      runStatus,
    }));
  }

  /** Every log the server stored, whichever run it belongs to. */
  async storedLogs() {
    const logs: Array<{
      number: number;
      type: string;
      values: Record<string, unknown>;
    }> = [];
    for await (const { number, type, values } of this.dataStore.getLogs()) {
      logs.push({ number, type, values });
    }
    return logs;
  }

  /**
   * The log numbers of each batch the client posted, in order. Includes the
   * batches the test answered itself with a fault.
   */
  async operationBatches() {
    const batches: number[][] = [];
    for (const { method, path, body } of this.#requests) {
      if (method !== 'POST' || path !== '/operations') continue;
      batches.push(
        parseOperations(await body).map((op) => op.data.attributes.number),
      );
    }
    return batches;
  }

  /** How many requests the client sent to a path, faulted ones included. */
  requestCount(method: string, path: string | RegExp) {
    return this.#requests.filter(
      (request) =>
        request.method === method &&
        (typeof path === 'string'
          ? request.path === path
          : path.test(request.path)),
    ).length;
  }
}

// Node's fetch has no cookie jar. This one follows the browser rule that
// matters here: a cross-origin request only stores and sends cookies when it
// asks for credentials. A client that forgets them loses its session.
function stubFetchWithCookieJar() {
  const baseFetch = globalThis.fetch;
  const jar = new CookieJar();
  // openapi-fetch reads globalThis.fetch when a client is created, so this
  // must be in place before the test creates one.
  vi.stubGlobal(
    'fetch',
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const withCredentials = request.credentials === 'include';
      if (withCredentials) {
        const cookie = await jar.getCookieString(request.url);
        if (cookie !== '') request.headers.set('cookie', cookie);
      }
      const response = await baseFetch(request);
      if (withCredentials) {
        for (const setCookie of response.headers.getSetCookie()) {
          await jar.setCookie(setCookie, request.url);
        }
      }
      return response;
    },
  );
}

export const serverTest = test.extend<{ server: TestServer }>({
  // eslint-disable-next-line no-empty-pattern
  server: async ({}, use) => {
    const server = await TestServer.start();
    await use(server);
    await server.stop();
  },
});
