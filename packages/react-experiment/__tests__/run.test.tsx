import { Client } from '@lightmill/log-client';
import { serverTest, type TestServer } from '@lightmill/test-server';
import { act, render, screen } from '@testing-library/react';
import userEventPackage from '@testing-library/user-event';
import { http, passthrough } from 'msw';
import * as React from 'react';
import { expect, vi } from 'vitest';
import { Run, useLogger, useTask } from '../src/main.js';

// @ts-expect-error - userEventPackage is not typed correctly
const userEvent: typeof userEventPackage.default = userEventPackage;

type Trial = { type: 'trial'; id: string };

function TrialTask() {
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

const elements = { tasks: { trial: <TrialTask /> }, completed: <p>The end</p> };

const timeline = () =>
  [
    { type: 'trial', id: 'a' },
    { type: 'trial', id: 'b' },
  ] satisfies Trial[];

function newClient(server: TestServer) {
  return new Client({ apiRoot: server.apiRoot });
}

function run(client: Client, props: Partial<React.ComponentProps<typeof Run>>) {
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

async function renderAsync(ui: React.ReactElement) {
  let result!: ReturnType<typeof render>;
  await act(async () => {
    result = render(ui);
  });
  return result;
}

function isUnloadPrevented() {
  const event = new Event('beforeunload', { cancelable: true });
  globalThis.dispatchEvent(event);
  return event.defaultPrevented;
}

// Holds the request ending the run until `release` is called.
function holdRunCompletion(server: TestServer) {
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

describe('Run', () => {
  serverTest(
    'plays every task of a new run, then shows the completed slot once the run is completed',
    async ({ server }) => {
      await server.addExperiment('exp');
      const release = holdRunCompletion(server);
      const user = userEvent.setup();
      await renderAsync(run(newClient(server), {}));

      await user.click(await screen.findByRole('button', { name: 'Done a' }));
      await user.click(await screen.findByRole('button', { name: 'Done b' }));

      // The logs are stored, but the run is still being completed.
      expect(await screen.findByText('Loading…')).toBeInTheDocument();
      expect(screen.queryByText('The end')).not.toBeInTheDocument();
      release();
      expect(await screen.findByText('The end')).toBeInTheDocument();
      await expect(server.storedRuns()).resolves.toEqual([
        { runName: 'run-1', runStatus: 'completed' },
      ]);
      await expect(server.storedLogs()).resolves.toMatchObject([
        { number: 1, type: 'trial-done', values: { taskId: 'a' } },
        { number: 2, type: 'trial-done', values: { taskId: 'b' } },
      ]);
    },
  );

  serverTest('sends one start request under StrictMode', async ({ server }) => {
    await server.addExperiment('exp');
    await renderAsync(
      <React.StrictMode>{run(newClient(server), {})}</React.StrictMode>,
    );

    expect(
      await screen.findByRole('button', { name: 'Done a' }),
    ).toBeInTheDocument();
    expect(server.requestCount('POST', '/runs')).toBe(1);
    await expect(server.storedRuns()).resolves.toHaveLength(1);
  });

  serverTest(
    'continues the run when remounted, neither repeating nor skipping the task in progress',
    async ({ server }) => {
      await server.addExperiment('exp');
      const client = newClient(server);
      const build = vi.fn(timeline);
      const user = userEvent.setup();
      const first = await renderAsync(run(client, { timeline: build }));
      await user.click(await screen.findByRole('button', { name: 'Done a' }));
      expect(
        await screen.findByRole('button', { name: 'Done b' }),
      ).toBeInTheDocument();
      first.unmount();

      await renderAsync(run(client, { timeline: build }));
      await user.click(await screen.findByRole('button', { name: 'Done b' }));

      expect(await screen.findByText('The end')).toBeInTheDocument();
      expect(build).toHaveBeenCalledTimes(1);
      expect(server.requestCount('POST', '/runs')).toBe(1);
      await expect(server.storedLogs()).resolves.toMatchObject([
        { number: 1, values: { taskId: 'a' } },
        { number: 2, values: { taskId: 'b' } },
      ]);
    },
  );

  serverTest(
    'switches to another run when the run name changes',
    async ({ server }) => {
      await server.addExperiment('exp');
      const client = newClient(server);
      const user = userEvent.setup();
      const { rerender } = await renderAsync(run(client, {}));
      await user.click(await screen.findByRole('button', { name: 'Done a' }));
      await user.click(await screen.findByRole('button', { name: 'Done b' }));
      expect(await screen.findByText('The end')).toBeInTheDocument();

      await act(async () => {
        rerender(run(client, { runName: 'run-2' }));
      });

      expect(
        await screen.findByRole('button', { name: 'Done a' }),
      ).toBeInTheDocument();
      const runs = await server.storedRuns();
      expect(runs).toHaveLength(2);
      expect(runs).toEqual(
        expect.arrayContaining([
          { runName: 'run-1', runStatus: 'completed' },
          { runName: 'run-2', runStatus: 'running' },
        ]),
      );
    },
  );

  serverTest(
    'asks for confirmation before unloading until the run is completed',
    async ({ server }) => {
      await server.addExperiment('exp');
      const user = userEvent.setup();
      await renderAsync(run(newClient(server), {}));
      await user.click(await screen.findByRole('button', { name: 'Done a' }));
      expect(isUnloadPrevented()).toBe(true);
      await user.click(await screen.findByRole('button', { name: 'Done b' }));

      expect(await screen.findByText('The end')).toBeInTheDocument();
      expect(isUnloadPrevented()).toBe(false);
    },
  );

  serverTest(
    'shows default loading and completed slots when omitted',
    async ({ server }) => {
      await server.addExperiment('exp');
      const user = userEvent.setup();
      await renderAsync(
        run(newClient(server), { elements: { tasks: elements.tasks } }),
      );
      // The run is being started.
      expect(screen.getByText('Loading…')).toBeInTheDocument();
      await user.click(await screen.findByRole('button', { name: 'Done a' }));
      await user.click(await screen.findByRole('button', { name: 'Done b' }));

      expect(await screen.findByText(/thank you/i)).toBeInTheDocument();
    },
  );
});
