import { serverTest, type TestServer } from '@lightmill/test-server';
import { act, screen } from '@testing-library/react';
import userEventPackage from '@testing-library/user-event';
import * as React from 'react';
import { expect, vi } from 'vitest';
import { Run, resumeAfter, useLogDelivery, useResumeRun } from '../src/main.js';
import {
  elements,
  holdRunCompletion,
  isUnloadPrevented,
  newClient,
  renderAsync,
  run,
  timeline,
} from './runTestUtils.js';

// @ts-expect-error - userEventPackage is not typed correctly
const userEvent: typeof userEventPackage.default = userEventPackage;

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
    'builds the timeline once under StrictMode',
    async ({ server }) => {
      await server.addExperiment('exp');
      const build = vi.fn(timeline);
      await renderAsync(
        <React.StrictMode>
          {run(newClient(server), { timeline: build })}
        </React.StrictMode>,
      );

      await screen.findByRole('button', { name: 'Done a' });
      expect(build).toHaveBeenCalledTimes(1);
    },
  );

  serverTest(
    'switches to another run when the experiment name changes',
    async ({ server }) => {
      await server.addExperiment('exp');
      await server.addExperiment('other');
      const client = newClient(server);
      const user = userEvent.setup();
      const { rerender } = await renderAsync(run(client, {}));
      await user.click(await screen.findByRole('button', { name: 'Done a' }));
      await user.click(await screen.findByRole('button', { name: 'Done b' }));
      expect(await screen.findByText('The end')).toBeInTheDocument();

      await act(async () => {
        rerender(run(client, { experimentName: 'other' }));
      });

      expect(
        await screen.findByRole('button', { name: 'Done a' }),
      ).toBeInTheDocument();
      await expect(server.storedRuns()).resolves.toHaveLength(2);
    },
  );

  serverTest(
    'switches to another run when the client changes',
    async ({ server }) => {
      await server.addExperiment('exp');
      const user = userEvent.setup();
      const { rerender } = await renderAsync(run(newClient(server), {}));
      await user.click(await screen.findByRole('button', { name: 'Done a' }));
      await user.click(await screen.findByRole('button', { name: 'Done b' }));
      expect(await screen.findByText('The end')).toBeInTheDocument();

      // Another client is another session: it does not own the first run.
      await act(async () => {
        rerender(run(newClient(server), {}));
      });

      expect(
        await screen.findByText(/A session with this name already exists/),
      ).toBeVisible();
      expect(screen.queryByText('The end')).not.toBeInTheDocument();
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

  serverTest(
    'lets elements.loading read the log delivery while the run starts',
    async ({ server }) => {
      await server.addExperiment('exp');
      function Loading() {
        const { inFlightLogs } = useLogDelivery();
        return <p>Starting with {inFlightLogs.length} logs held</p>;
      }
      await renderAsync(
        run(newClient(server), {
          elements: { ...elements, loading: <Loading /> },
        }),
      );

      expect(screen.getByText('Starting with 0 logs held')).toBeVisible();
      await screen.findByRole('button', { name: 'Done a' });
    },
  );

  describe('resuming', () => {
    const resumableTimeline = ({
      resumeLog,
    }: {
      resumeLog: Record<string, unknown> | null;
    }) =>
      resumeLog == null
        ? timeline()
        : resumeAfter(timeline(), (task) => task.id === resumeLog.taskId);

    // Plays the first task of a run, waits until its log is stored, then
    // drops the page, like a reload does.
    async function leaveRunAfterFirstTask(
      server: TestServer,
      props: Partial<React.ComponentProps<typeof Run>> = {},
    ) {
      const user = userEvent.setup();
      const page = await renderAsync(run(newClient(server), props));
      await user.click(await screen.findByRole('button', { name: 'Done a' }));
      await vi.waitFor(async () => {
        expect(await server.storedLogs()).toHaveLength(1);
      });
      page.unmount();
    }

    serverTest(
      'asks before resuming, then continues after the last completed task',
      async ({ server }) => {
        await server.addExperiment('exp');
        await leaveRunAfterFirstTask(server);
        const user = userEvent.setup();
        await renderAsync(
          run(newClient(server), { timeline: resumableTimeline }),
        );

        await user.click(await screen.findByRole('button', { name: 'Resume' }));
        await user.click(await screen.findByRole('button', { name: 'Done b' }));

        expect(await screen.findByText('The end')).toBeInTheDocument();
        await expect(server.storedRuns()).resolves.toEqual([
          { runName: 'run-1', runStatus: 'completed' },
        ]);
        await expect(server.storedLogs()).resolves.toMatchObject([
          { number: 1, values: { taskId: 'a' } },
          { number: 2, values: { taskId: 'b' } },
        ]);
        expect(server.requestCount('POST', '/runs')).toBe(1);
      },
    );

    serverTest(
      'does not play anything until the participant confirms',
      async ({ server }) => {
        await server.addExperiment('exp');
        await leaveRunAfterFirstTask(server);
        const build = vi.fn(resumableTimeline);
        await renderAsync(run(newClient(server), { timeline: build }));

        expect(
          await screen.findByRole('button', { name: 'Resume' }),
        ).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Done/ })).toBeNull();
        expect(build).not.toHaveBeenCalled();
        expect(server.requestCount('PATCH', /^\/runs\//)).toBe(0);
      },
    );

    serverTest(
      'renders elements.resume with useResumeRun',
      async ({ server }) => {
        await server.addExperiment('exp');
        await leaveRunAfterFirstTask(server);
        function CustomResume() {
          const { resume, run, lastLog } = useResumeRun();
          return (
            <button onClick={resume}>
              Continue {run.name} ({run.status}) after {String(lastLog?.taskId)}
            </button>
          );
        }
        const user = userEvent.setup();
        await renderAsync(
          run(newClient(server), {
            timeline: resumableTimeline,
            elements: { ...elements, resume: <CustomResume /> },
          }),
        );

        await user.click(
          await screen.findByRole('button', {
            name: 'Continue run-1 (running) after a',
          }),
        );

        expect(
          await screen.findByRole('button', { name: 'Done b' }),
        ).toBeInTheDocument();
      },
    );

    serverTest(
      'lets elements.resume read the log delivery',
      async ({ server }) => {
        await server.addExperiment('exp');
        await leaveRunAfterFirstTask(server);
        function CustomResume() {
          const { inFlightLogs } = useLogDelivery();
          return <p>Resume with {inFlightLogs.length} logs held</p>;
        }
        await renderAsync(
          run(newClient(server), {
            timeline: resumableTimeline,
            elements: { ...elements, resume: <CustomResume /> },
          }),
        );

        expect(
          await screen.findByText('Resume with 0 logs held'),
        ).toBeVisible();
      },
    );

    serverTest(
      'shows the prompt at resume number 0 and builds with a null resume log',
      async ({ server }) => {
        await server.addExperiment('exp');
        const user = userEvent.setup();
        const first = await renderAsync(run(newClient(server), {}));
        await screen.findByRole('button', { name: 'Done a' });
        first.unmount();
        const build = vi.fn(resumableTimeline);
        await renderAsync(run(newClient(server), { timeline: build }));

        await user.click(await screen.findByRole('button', { name: 'Resume' }));

        expect(
          await screen.findByRole('button', { name: 'Done a' }),
        ).toBeInTheDocument();
        expect(build).toHaveBeenCalledExactlyOnceWith({ resumeLog: null });
      },
    );

    serverTest(
      'gives the builder the state that was logged',
      async ({ server }) => {
        await server.addExperiment('exp');
        // A staircase: the next level depends on the logged one.
        const staircase = ({
          resumeLog,
        }: {
          resumeLog: Record<string, unknown> | null;
        }) => {
          const next = resumeLog == null ? 1 : Number(resumeLog.level) + 1;
          return [next, next + 1].map((level) => ({
            type: 'trial',
            id: `level-${level}`,
            level,
          }));
        };
        const user = userEvent.setup();
        const first = await renderAsync(
          run(newClient(server), { timeline: staircase }),
        );
        await user.click(
          await screen.findByRole('button', { name: 'Done level-1' }),
        );
        await vi.waitFor(async () => {
          expect(await server.storedLogs()).toHaveLength(1);
        });
        first.unmount();
        await renderAsync(run(newClient(server), { timeline: staircase }));

        await user.click(await screen.findByRole('button', { name: 'Resume' }));

        expect(
          await screen.findByRole('button', { name: 'Done level-2' }),
        ).toBeInTheDocument();
      },
    );

    serverTest(
      'sends one resume request when the participant double-clicks or StrictMode renders twice',
      async ({ server }) => {
        await server.addExperiment('exp');
        await leaveRunAfterFirstTask(server);
        const user = userEvent.setup();
        await renderAsync(
          <React.StrictMode>
            {run(newClient(server), { timeline: resumableTimeline })}
          </React.StrictMode>,
        );

        await user.dblClick(
          await screen.findByRole('button', { name: 'Resume' }),
        );

        expect(
          await screen.findByRole('button', { name: 'Done b' }),
        ).toBeInTheDocument();
        expect(server.requestCount('PATCH', /^\/runs\//)).toBe(1);
        expect(server.requestCount('GET', '/runs')).toBe(1);
      },
    );
  });
});
