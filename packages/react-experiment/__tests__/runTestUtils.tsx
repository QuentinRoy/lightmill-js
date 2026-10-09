import { Client } from '@lightmill/log-client';
import type { TestServer } from '@lightmill/test-server';
import { act, render, type RenderResult } from '@testing-library/react';
import { http, HttpResponse, passthrough } from 'msw';
import * as React from 'react';
import type { RunLogger } from '../src/logClient.js';
import { Run, useLogger, useTask } from '../src/main.js';
import { getRunStore } from '../src/runStore.js';

export function TrialTask() {
  const { task, onTaskCompleted } = useTask('trial');
  const addLog = useLogger('trial-done');
  return (
    <button
      onClick={() => {
        addLog({ taskId: task.id, level: task.level });
        onTaskCompleted();
      }}
    >
      Done {String(task.id)}
    </button>
  );
}

export const timeline = () => [
  { type: 'trial', id: 'a' },
  { type: 'trial', id: 'b' },
];

export const elements = {
  tasks: { trial: <TrialTask /> },
  completed: <p>The end</p>,
};

export function newClient(server: TestServer): Client {
  return new Client({ apiRoot: server.apiRoot });
}

export function run(
  client: Client,
  props: Partial<React.ComponentProps<typeof Run>> = {},
) {
  return (
    <Run
      client={client}
      experimentName="exp"
      runName="run-1"
      resumableLogTypes={['trial-done']}
      timeline={timeline}
      elements={elements}
      {...props}
    />
  );
}

export async function renderAsync(
  ui: React.ReactElement,
): Promise<RenderResult> {
  let result!: RenderResult;
  await act(async () => {
    result = render(ui);
  });
  return result;
}

export function isUnloadPrevented() {
  const event = new Event('beforeunload', { cancelable: true });
  globalThis.dispatchEvent(event);
  return event.defaultPrevented;
}

/**
 * Makes the server refuse every log until `clear` is called. `failWith`
 * changes the status of the refusals, so a test can tell errors apart.
 */
export function failDelivery(server: TestServer, status = 503) {
  let failingStatus: number | null = status;
  server.msw.use(
    http.post(`${server.apiRoot}/operations`, () =>
      failingStatus == null
        ? passthrough()
        : // Retry-After beyond the retry budget pauses the logger at once.
          new HttpResponse(null, {
            status: failingStatus,
            headers: { 'Retry-After': '3600' },
          }),
    ),
  );
  return {
    failWith(newStatus: number) {
      failingStatus = newStatus;
    },
    clear() {
      failingStatus = null;
    },
  };
}

/** Makes the server answer the matching request with a 400 and `detail`. */
export function failRequest(
  server: TestServer,
  method: 'patch' | 'post',
  path: string,
  detail = 'Refused',
) {
  server.msw.use(
    http[method](`${server.apiRoot}${path}`, () =>
      HttpResponse.json(
        { errors: [{ status: '400', detail }] },
        { status: 400 },
      ),
    ),
  );
}

/**
 * The logger of the ongoing run that `run(client)` plays. Only once its first
 * task is shown.
 */
export function loggerOf(client: Client): RunLogger {
  const state = getRunStore({
    client,
    experimentName: 'exp',
    runName: 'run-1',
    resumableLogTypes: ['trial-done'],
  }).getSnapshot();
  if (state.status !== 'ready') throw new Error('The run is not ready');
  return state.logger;
}

// Holds the request ending the run until `release` is called.
export function holdRunCompletion(server: TestServer) {
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  server.msw.use(
    http.patch(`${server.apiRoot}/runs/:id`, async () => {
      await released;
      return passthrough();
    }),
  );
  return release;
}
