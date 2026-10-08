import { serverTest } from '@lightmill/test-server';
import { renderHook, screen } from '@testing-library/react';
import userEventPackage from '@testing-library/user-event';
import * as React from 'react';
import { expect, vi } from 'vitest';
import type { RunClient, RunLogger } from '../src/logClient.js';
import { useLogDelivery, useTask } from '../src/main.js';
import { LogDeliveryProvider } from '../src/useLogDelivery.js';
import {
  failDelivery,
  newClient,
  renderAsync,
  run,
  TrialTask,
} from './runTestUtils.js';

// @ts-expect-error - userEventPackage is not typed correctly
const userEvent: typeof userEventPackage.default = userEventPackage;

describe('Run when delivery is paused', () => {
  serverTest(
    'shows the default paused slot with the held logs, and resumes once a retry succeeds',
    async ({ server }) => {
      await server.addExperiment('exp');
      const fault = failDelivery(server);
      const user = userEvent.setup();
      await renderAsync(run(newClient(server)));

      await user.click(await screen.findByRole('button', { name: 'Done a' }));
      await user.click(await screen.findByRole('button', { name: 'Done b' }));

      const link = await screen.findByRole('link', { name: /download/i });
      const prefix = 'data:application/json;charset=utf-8,';
      expect(link).toHaveAttribute('download');
      const href = link.getAttribute('href') ?? '';
      expect(href.startsWith(prefix)).toBe(true);
      expect(
        JSON.parse(decodeURIComponent(href.slice(prefix.length))),
      ).toMatchObject([
        { type: 'trial-done', taskId: 'a' },
        { type: 'trial-done', taskId: 'b' },
      ]);
      expect(screen.queryByText('The end')).not.toBeInTheDocument();
      await expect(server.storedLogs()).resolves.toEqual([]);

      fault.clear();
      await user.click(screen.getByRole('button', { name: /retry/i }));

      expect(await screen.findByText('The end')).toBeInTheDocument();
      await expect(server.storedLogs()).resolves.toMatchObject([
        { number: 1, values: { taskId: 'a' } },
        { number: 2, values: { taskId: 'b' } },
      ]);
      await expect(server.storedRuns()).resolves.toEqual([
        { runName: 'run-1', runStatus: 'completed' },
      ]);
    },
  );

  serverTest(
    'goes back to paused with the new error when a retry fails, without rejecting',
    async ({ server }) => {
      await server.addExperiment('exp');
      const fault = failDelivery(server, 503);
      const user = userEvent.setup();
      function Paused() {
        const { error, inFlightLogs, retry } = useLogDelivery();
        return (
          <div>
            <p>Paused: {error?.message}</p>
            <p>Held: {inFlightLogs.length}</p>
            <button onClick={() => void retry()}>Try again</button>
          </div>
        );
      }
      await renderAsync(
        run(newClient(server), {
          elements: { tasks: { trial: <TrialTask /> }, paused: <Paused /> },
        }),
      );
      await user.click(await screen.findByRole('button', { name: 'Done a' }));
      await user.click(await screen.findByRole('button', { name: 'Done b' }));
      expect(await screen.findByText(/Paused: .*Unavailable/)).toBeVisible();

      fault.failWith(500);
      await user.click(screen.getByRole('button', { name: 'Try again' }));

      expect(
        await screen.findByText(/Paused: .*Internal Server Error/),
      ).toBeVisible();
      expect(screen.getByText('Held: 2')).toBeVisible();

      fault.clear();
      await user.click(screen.getByRole('button', { name: 'Try again' }));
      await vi.waitFor(async () => {
        await expect(server.storedLogs()).resolves.toHaveLength(2);
      });
    },
  );

  serverTest(
    'gives retry a stable identity, which does nothing when delivery is not paused',
    async ({ server }) => {
      await server.addExperiment('exp');
      const retries = new Set<() => Promise<void>>();
      function Task() {
        const { retry } = useLogDelivery();
        const { onTaskCompleted } = useTask();
        const [, setCount] = React.useState(0);
        retries.add(retry);
        return (
          <>
            <button onClick={() => setCount((count) => count + 1)}>
              Render
            </button>
            <button onClick={onTaskCompleted}>Next</button>
          </>
        );
      }
      const user = userEvent.setup();
      await renderAsync(
        run(newClient(server), { elements: { tasks: { trial: <Task /> } } }),
      );
      await user.click(await screen.findByRole('button', { name: 'Render' }));
      await user.click(screen.getByRole('button', { name: 'Next' }));
      await user.click(await screen.findByRole('button', { name: 'Render' }));

      expect(retries.size).toBe(1);
      const [retry] = retries;
      await expect(retry()).resolves.toBeUndefined();
      expect(server.requestCount('POST', '/operations')).toBe(0);
    },
  );

  serverTest(
    'sends a rejection of a log that is not held to the error slot',
    async ({ server }) => {
      await server.addExperiment('exp');
      const logger = {
        state: { status: 'idle' },
        inFlightLogs: [],
        subscribe: () => () => {},
        addLog: () => Promise.reject(new Error('Unknown log')),
        completeRun: () => Promise.resolve(),
        interruptRun: () => Promise.resolve(),
      } as unknown as RunLogger;
      const client: RunClient = {
        getResumableRuns: () => Promise.resolve([]),
        startRun: () => Promise.resolve(logger),
      };
      const user = userEvent.setup();
      vi.spyOn(console, 'error').mockImplementation(() => {});
      await renderAsync(run(client as never));
      await user.click(await screen.findByRole('button', { name: 'Done a' }));

      expect(await screen.findByText(/unexpected error/)).toBeVisible();
      expect(screen.getByRole('group')).toHaveTextContent('Unknown log');
    },
  );
});

describe('useLogDelivery', () => {
  it('has nothing to retry or download without a logger', async () => {
    const { result } = renderHook(() => useLogDelivery(), {
      wrapper: ({ children }) => (
        <LogDeliveryProvider logger={null}>{children}</LogDeliveryProvider>
      ),
    });

    expect(result.current).toEqual({
      error: null,
      inFlightLogs: [],
      retry: expect.any(Function),
    });
    await expect(result.current.retry()).resolves.toBeUndefined();
  });

  it('throws outside of a Run', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useLogDelivery())).toThrow(/<Run \/>/);
  });
});
