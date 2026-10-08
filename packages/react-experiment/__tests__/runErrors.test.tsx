import { serverTest } from '@lightmill/test-server';
import { screen } from '@testing-library/react';
import userEventPackage from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import * as React from 'react';
import { expect, vi } from 'vitest';
import {
  LogDeliveryError,
  useLogger,
  useRunError,
  useTask,
} from '../src/main.js';
import {
  failDelivery,
  failRequest,
  isUnloadPrevented,
  loggerOf,
  newClient,
  renderAsync,
  run,
  TrialTask,
} from './runTestUtils.js';

// @ts-expect-error - userEventPackage is not typed correctly
const userEvent: typeof userEventPackage.default = userEventPackage;

// Logs a, then crashes while rendering.
function CrashingTask() {
  const addLog = useLogger('trial-done');
  const [crashed, setCrashed] = React.useState(false);
  if (crashed) throw new Error('Task bug');
  return (
    <button
      onClick={() => {
        addLog({ taskId: 'a' });
        setCrashed(true);
      }}
    >
      Crash
    </button>
  );
}

const crashingElements = { tasks: { trial: <CrashingTask /> } };

class AppBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    return this.state.error == null ? (
      this.props.children
    ) : (
      <p>App boundary: {this.state.error.message}</p>
    );
  }
}

const genericSentence =
  'The experiment could not continue because of an unexpected error. Contact the experimenter and give them the details below.';

describe('Run when the run cannot start', () => {
  serverTest(
    'tells the participant that the run name already exists (RUN_EXISTS)',
    async ({ server }) => {
      // A run of another session: not resumable from this one.
      await server.dataStore.withTransaction(async (tx) => {
        const { experimentId } = await tx.addExperiment({
          experimentName: 'exp',
        });
        await tx.addRun({ experimentId, runName: 'run-1' });
      });

      await renderAsync(run(newClient(server)));

      expect(
        await screen.findByText(
          'A session with this name already exists. It may already be running on this device.',
        ),
      ).toBeVisible();
      expect(screen.queryByText(genericSentence)).not.toBeInTheDocument();
    },
  );

  serverTest(
    'tells the participant that a session is in progress (ONGOING_RUNS)',
    async ({ server }) => {
      await server.addExperiment('exp');
      await newClient(server).startRun({
        experimentName: 'exp',
        runName: 'other-run',
      });

      await renderAsync(run(newClient(server)));

      expect(
        await screen.findByText(
          'You already have a session in progress, perhaps in another tab or on another device.',
        ),
      ).toBeVisible();
    },
  );

  serverTest(
    'shows the generic sentence and a collapsed details block for an unknown error',
    async ({ server }) => {
      await server.addExperiment('exp');
      server.msw.use(
        http.post(`${server.apiRoot}/runs`, () =>
          HttpResponse.json(
            { errors: [{ status: '500', detail: 'The database is on fire' }] },
            { status: 500 },
          ),
        ),
      );

      await renderAsync(run(newClient(server)));

      expect(await screen.findByText(genericSentence)).toBeVisible();
      expect(screen.queryByText(/reload/i)).not.toBeInTheDocument();
      const details = screen.getByRole('group');
      expect(details).not.toHaveAttribute('open');
      expect(details).toHaveTextContent('Experiment: exp');
      expect(details).toHaveTextContent('Run: run-1');
      expect(details).toHaveTextContent('Status: 500');
      expect(details).toHaveTextContent('The database is on fire');
    },
  );

  serverTest('gives elements.error the thrown value unchanged', async () => {
    const thrown = { not: 'an error' };
    const client = {
      getResumableRuns: () => Promise.reject(thrown),
      startRun: () => Promise.reject(thrown),
    };
    let seen: unknown;
    function Custom() {
      seen = useRunError().error;
      return <p>Custom error</p>;
    }

    await renderAsync(
      run(client as never, {
        elements: { tasks: { trial: <TrialTask /> }, error: <Custom /> },
      }),
    );

    expect(await screen.findByText('Custom error')).toBeVisible();
    expect(seen).toBe(thrown);
  });
});

describe('the default error slot details', () => {
  function runFailingWith(thrown: unknown) {
    const client = {
      getResumableRuns: () => Promise.reject(thrown),
      startRun: () => Promise.reject(thrown),
    };
    return renderAsync(run(client as never));
  }

  serverTest('lists the causes, up to a limit', async () => {
    let error = new Error('Cause 8');
    for (let depth = 7; depth >= 0; depth--) {
      error = new Error(`Cause ${depth}`, { cause: error });
    }

    await runFailingWith(error);

    const details = (await screen.findByRole('group')).textContent ?? '';
    expect(details).toContain('Cause 0');
    expect(details).toContain('Cause 5');
    expect(details).not.toContain('Cause 6');
    expect(details.match(/Caused by:/g)).toHaveLength(5);
  });

  serverTest('describes a value that is not an error', async () => {
    await runFailingWith('just a string');

    expect(await screen.findByRole('group')).toHaveTextContent('just a string');
  });

  serverTest(
    'has nothing to download or retry when the run never started',
    async () => {
      await runFailingWith(new Error('No logger'));

      await screen.findByText(/unexpected error/);
      expect(screen.queryByRole('link')).toBeNull();
      expect(screen.queryByRole('button')).toBeNull();
    },
  );
});

describe('Run when the run crashes', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  serverTest(
    'shows the error slot, interrupts the run, and lands on the resume prompt after a reload',
    async ({ server }) => {
      await server.addExperiment('exp');
      const user = userEvent.setup();
      const page = await renderAsync(
        run(newClient(server), { elements: crashingElements }),
      );

      await user.click(await screen.findByRole('button', { name: 'Crash' }));

      expect(await screen.findByText(/unexpected error/)).toBeVisible();
      expect(screen.getByRole('group')).toHaveTextContent('Task bug');
      await vi.waitFor(async () => {
        await expect(server.storedRuns()).resolves.toEqual([
          { runName: 'run-1', runStatus: 'interrupted' },
        ]);
      });
      await expect(server.storedLogs()).resolves.toMatchObject([
        { number: 1, values: { taskId: 'a' } },
      ]);
      expect(isUnloadPrevented()).toBe(false);

      page.unmount();
      await renderAsync(run(newClient(server)));
      expect(
        await screen.findByRole('button', { name: 'Resume' }),
      ).toBeVisible();
    },
  );

  serverTest(
    'keeps the download link and a retry button while delivery is paused, then interrupts once a retry succeeds',
    async ({ server }) => {
      await server.addExperiment('exp');
      const fault = failDelivery(server);
      const user = userEvent.setup();
      await renderAsync(run(newClient(server), { elements: crashingElements }));

      await user.click(await screen.findByRole('button', { name: 'Crash' }));

      const link = await screen.findByRole('link', { name: /download/i });
      expect(decodeURIComponent(link.getAttribute('href') ?? '')).toContain(
        '"taskId": "a"',
      );
      expect(isUnloadPrevented()).toBe(true);
      await expect(server.storedRuns()).resolves.toEqual([
        { runName: 'run-1', runStatus: 'running' },
      ]);

      fault.clear();
      await user.click(await screen.findByRole('button', { name: /retry/i }));

      await vi.waitFor(async () => {
        await expect(server.storedRuns()).resolves.toEqual([
          { runName: 'run-1', runStatus: 'interrupted' },
        ]);
      });
      await expect(server.storedLogs()).resolves.toHaveLength(1);
      expect(screen.getByText(/unexpected error/)).toBeVisible();
      expect(screen.queryByRole('button', { name: /retry/i })).toBeNull();
      expect(isUnloadPrevented()).toBe(false);
    },
  );

  serverTest(
    'keeps showing the original error when the interrupt fails',
    async ({ server }) => {
      await server.addExperiment('exp');
      failRequest(server, 'patch', '/runs/:id', 'Cannot interrupt');
      const user = userEvent.setup();
      await renderAsync(run(newClient(server), { elements: crashingElements }));

      await user.click(await screen.findByRole('button', { name: 'Crash' }));

      await vi.waitFor(() => {
        expect(console.warn).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({ message: 'Cannot interrupt' }),
        );
      });
      const details = screen.getByRole('group');
      expect(details).toHaveTextContent('Task bug');
      expect(details).not.toHaveTextContent('Cannot interrupt');
    },
  );

  serverTest(
    'sends what elements.error throws to the app error boundary',
    async ({ server }) => {
      await server.addExperiment('exp');
      function Rethrow(): never {
        throw useRunError().error;
      }
      const user = userEvent.setup();
      await renderAsync(
        <AppBoundary>
          {run(newClient(server), {
            elements: { ...crashingElements, error: <Rethrow /> },
          })}
        </AppBoundary>,
      );

      await user.click(await screen.findByRole('button', { name: 'Crash' }));

      expect(await screen.findByText('App boundary: Task bug')).toBeVisible();
    },
  );

  serverTest(
    'shows the error slot when the timeline builder throws',
    async ({ server }) => {
      await server.addExperiment('exp');
      const build = vi.fn(() => {
        throw new Error('Builder bug');
      });

      await renderAsync(run(newClient(server), { timeline: build }));

      expect(await screen.findByText(/unexpected error/)).toBeVisible();
      expect(screen.getByRole('group')).toHaveTextContent('Builder bug');
      expect(build).toHaveBeenCalledTimes(1);
      await vi.waitFor(async () => {
        await expect(server.storedRuns()).resolves.toEqual([
          { runName: 'run-1', runStatus: 'interrupted' },
        ]);
      });
    },
  );

  serverTest(
    'shows the error slot when completing the run is refused',
    async ({ server }) => {
      await server.addExperiment('exp');
      failRequest(server, 'patch', '/runs/:id', 'Cannot complete');
      const user = userEvent.setup();
      await renderAsync(run(newClient(server)));

      await user.click(await screen.findByRole('button', { name: 'Done a' }));
      await user.click(await screen.findByRole('button', { name: 'Done b' }));

      expect(await screen.findByText(/unexpected error/)).toBeVisible();
      expect(screen.getByRole('group')).toHaveTextContent('Cannot complete');
      expect(screen.queryByText('The end')).not.toBeInTheDocument();
    },
  );

  serverTest(
    'gives elements.error the rejection of addLog unchanged',
    async ({ server }) => {
      await server.addExperiment('exp');
      const client = newClient(server);
      let seen: unknown;
      function Custom() {
        seen = useRunError().error;
        return <p>Custom error</p>;
      }
      const user = userEvent.setup();
      await renderAsync(
        run(client, {
          elements: { tasks: { trial: <TrialTask /> }, error: <Custom /> },
        }),
      );
      await screen.findByRole('button', { name: 'Done a' });
      // The logger refuses every log, and none of them is held.
      await loggerOf(client).interruptRun();

      await user.click(screen.getByRole('button', { name: 'Done a' }));

      expect(await screen.findByText('Custom error')).toBeVisible();
      expect(seen).not.toBeInstanceOf(LogDeliveryError);
      expect(seen).toEqual(
        expect.objectContaining({
          message: expect.stringContaining('Can only add logs'),
        }),
      );
    },
  );

  serverTest(
    'keeps the error slot and the held logs when Run is remounted before the run is interrupted',
    async ({ server }) => {
      await server.addExperiment('exp');
      failDelivery(server);
      const client = newClient(server);
      const user = userEvent.setup();
      const page = await renderAsync(
        run(client, { elements: crashingElements }),
      );
      await user.click(await screen.findByRole('button', { name: 'Crash' }));
      await screen.findByRole('link', { name: /download/i });
      page.unmount();

      await renderAsync(run(client, { elements: crashingElements }));

      expect(await screen.findByText(/unexpected error/)).toBeVisible();
      expect(screen.getByRole('link', { name: /download/i })).toBeVisible();
      expect(server.requestCount('POST', '/runs')).toBe(1);
    },
  );
});
