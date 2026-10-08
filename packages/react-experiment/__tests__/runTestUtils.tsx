import { Client } from '@lightmill/log-client';
import type { TestServer } from '@lightmill/test-server';
import { act, render, type RenderResult } from '@testing-library/react';
import { http, HttpResponse, passthrough } from 'msw';
import * as React from 'react';
import { Run, useLogger, useTask } from '../src/main.js';

export function TrialTask() {
  const { task, onTaskCompleted } = useTask('trial');
  const addLog = useLogger('trial-done');
  return (
    <button
      onClick={() => {
        addLog({ taskId: task.id });
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
      elements={{ tasks: { trial: <TrialTask /> }, completed: <p>The end</p> }}
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
