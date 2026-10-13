import { serverTest, type TestServer } from '@lightmill/test-server';
import { act, screen } from '@testing-library/react';
import userEventPackage from '@testing-library/user-event';
import * as React from 'react';
import { expect, vi } from 'vitest';
import {
  Run,
  useLogDelivery,
  useLogger,
  useResumeRun,
  useTask,
} from '../src/main.js';
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
        { number: 1, type: 'trial', values: { taskId: 'a' } },
        { number: 2, type: 'trial', values: { taskId: 'b' } },
      ]);
    },
  );

  serverTest(
    'passes the result of completeTask to the timeline',
    async ({ server }) => {
      await server.addExperiment('exp');
      const user = userEvent.setup();
      const received: unknown[] = [];
      const AnswerTask = () => {
        const { task, completeTask } = useTask('trial');
        return (
          <button onClick={() => completeTask({ answer: task.id })}>
            Answer {String(task.id)}
          </button>
        );
      };
      await renderAsync(
        run(newClient(server), {
          elements: { ...elements, tasks: { trial: <AnswerTask /> } },
          timeline: (async function* () {
            received.push(yield { type: 'trial', id: 'a' });
            received.push(yield { type: 'trial', id: 'b' });
          })(),
        }),
      );

      await user.click(await screen.findByRole('button', { name: 'Answer a' }));
      await user.click(await screen.findByRole('button', { name: 'Answer b' }));

      expect(await screen.findByText('The end')).toBeInTheDocument();
      expect(received).toEqual([{ answer: 'a' }, { answer: 'b' }]);
    },
  );

  serverTest(
    'stores one completion log per task, typed with the task type, stamped with its id and holding its result',
    async ({ server }) => {
      await server.addExperiment('exp');
      const user = userEvent.setup();
      const AnswerTask = () => {
        const { task, completeTask } = useTask('trial');
        const addNote = useLogger('note');
        return (
          <button
            onClick={() => {
              addNote({ text: `note ${String(task.id)}` });
              completeTask(task.id === 'a' ? { answer: 42 } : undefined);
            }}
          >
            Answer {String(task.id)}
          </button>
        );
      };
      await renderAsync(
        run(newClient(server), {
          elements: { ...elements, tasks: { trial: <AnswerTask /> } },
        }),
      );

      await user.click(await screen.findByRole('button', { name: 'Answer a' }));
      await user.click(await screen.findByRole('button', { name: 'Answer b' }));

      expect(await screen.findByText('The end')).toBeInTheDocument();
      const logs = await server.storedLogs();
      expect(logs).toMatchObject([
        { number: 1, type: 'note', values: { text: 'note a' } },
        { number: 2, type: 'trial', values: { taskId: 'a', answer: 42 } },
        { number: 3, type: 'note', values: { text: 'note b' } },
        { number: 4, type: 'trial', values: { taskId: 'b' } },
      ]);
      // An empty result logs no values beyond the id and the date.
      expect(Object.keys(logs[3]?.values ?? {}).sort()).toEqual([
        'date',
        'taskId',
      ]);
    },
  );

  serverTest.for(['type', 'taskId', 'date'])(
    'throws when a result holds the reserved key %s, keeping the task incomplete',
    async (key, { server }) => {
      await server.addExperiment('exp');
      const user = userEvent.setup();
      const ReservedTask = () => {
        const { task, completeTask } = useTask('trial');
        const [error, setError] = React.useState<string | null>(null);
        return (
          <>
            <button
              onClick={() => {
                try {
                  completeTask({ [key]: 'x', answer: 1 });
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e));
                }
              }}
            >
              Answer {String(task.id)}
            </button>
            {error != null && <p role="alert">{error}</p>}
          </>
        );
      };
      await renderAsync(
        run(newClient(server), {
          elements: { ...elements, tasks: { trial: <ReservedTask /> } },
        }),
      );

      await user.click(await screen.findByRole('button', { name: 'Answer a' }));

      expect(screen.getByRole('alert')).toHaveTextContent(key);
      expect(screen.getByRole('button', { name: 'Answer a' })).toBeVisible();
      expect(server.requestCount('POST', '/operations')).toBe(0);
    },
  );

  serverTest(
    'throws when useLogger logs a task type, leaving completion logs to completeTask',
    async ({ server }) => {
      await server.addExperiment('exp');
      const user = userEvent.setup();
      const LoggingTask = () => {
        const { task } = useTask('trial');
        const addLog = useLogger();
        const [error, setError] = React.useState<string | null>(null);
        return (
          <>
            <button
              onClick={() => {
                try {
                  addLog({ type: 'trial' });
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e));
                }
              }}
            >
              Log {String(task.id)}
            </button>
            {error != null && <p role="alert">{error}</p>}
          </>
        );
      };
      await renderAsync(
        run(newClient(server), {
          elements: { ...elements, tasks: { trial: <LoggingTask /> } },
        }),
      );

      await user.click(await screen.findByRole('button', { name: 'Log a' }));

      expect(screen.getByRole('alert')).toHaveTextContent(/task type/);
      expect(screen.getByRole('button', { name: 'Log a' })).toBeVisible();
      expect(server.requestCount('POST', '/operations')).toBe(0);
    },
  );

  serverTest(
    'shows the error slot without rendering a task that has no id',
    async ({ server }) => {
      await server.addExperiment('exp');
      const rendered = vi.fn();
      function Task() {
        rendered();
        return null;
      }
      await renderAsync(
        run(newClient(server), {
          elements: { tasks: { trial: <Task /> } },
          timeline: [{ type: 'trial' }],
        }),
      );

      expect(await screen.findByText(/unexpected error/)).toBeVisible();
      expect(screen.getByRole('group')).toHaveTextContent(/has no id/);
      expect(rendered).not.toHaveBeenCalled();
    },
  );

  serverTest(
    'shows the error slot without rendering a task whose id was already used',
    async ({ server }) => {
      await server.addExperiment('exp');
      const user = userEvent.setup();
      await renderAsync(
        run(newClient(server), {
          timeline: [
            { type: 'trial', id: 'a' },
            { type: 'trial', id: 'a' },
          ],
        }),
      );

      await user.click(await screen.findByRole('button', { name: 'Done a' }));

      expect(await screen.findByText(/unexpected error/)).toBeVisible();
      expect(screen.getByRole('group')).toHaveTextContent(/a is already used/);
      expect(screen.queryByRole('button', { name: 'Done a' })).toBeNull();
      await vi.waitFor(async () => {
        await expect(server.storedRuns()).resolves.toEqual([
          { runName: 'run-1', runStatus: 'interrupted' },
        ]);
      });
      await expect(server.storedLogs()).resolves.toHaveLength(1);
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

  serverTest('reads the timeline once under StrictMode', async ({ server }) => {
    await server.addExperiment('exp');
    const read = vi.fn(() => timeline.values());
    await renderAsync(
      <React.StrictMode>
        {run(newClient(server), { timeline: { [Symbol.iterator]: read } })}
      </React.StrictMode>,
    );

    await screen.findByRole('button', { name: 'Done a' });
    expect(read).toHaveBeenCalledTimes(1);
  });

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
        await renderAsync(run(newClient(server), {}));

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
      'resumes without the prompt, showing loading, with dangerouslyAutoResume',
      async ({ server }) => {
        await server.addExperiment('exp');
        await leaveRunAfterFirstTask(server);
        const shown: string[] = [];
        function Track({ name }: { name: string }) {
          shown.push(name);
          return null;
        }
        const user = userEvent.setup();
        await renderAsync(
          run(newClient(server), {
            dangerouslyAutoResume: true,
            elements: {
              ...elements,
              loading: <Track name="loading" />,
              resume: <Track name="resume" />,
            },
          }),
        );

        await user.click(await screen.findByRole('button', { name: 'Done b' }));

        expect(await screen.findByText('The end')).toBeInTheDocument();
        expect(shown).toContain('loading');
        expect(shown).not.toContain('resume');
        await expect(server.storedLogs()).resolves.toMatchObject([
          { number: 1, values: { taskId: 'a' } },
          { number: 2, values: { taskId: 'b' } },
        ]);
      },
    );

    serverTest(
      'does not play anything until the participant confirms',
      async ({ server }) => {
        await server.addExperiment('exp');
        await leaveRunAfterFirstTask(server);
        const read = vi.fn(() => timeline.values());
        await renderAsync(
          run(newClient(server), { timeline: { [Symbol.iterator]: read } }),
        );

        expect(
          await screen.findByRole('button', { name: 'Resume' }),
        ).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Done/ })).toBeNull();
        expect(read).not.toHaveBeenCalled();
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
            elements: { ...elements, resume: <CustomResume /> },
          }),
        );

        expect(
          await screen.findByText('Resume with 0 logs held'),
        ).toBeVisible();
      },
    );

    serverTest(
      'shows the prompt at resume number 0, then plays from the first task',
      async ({ server }) => {
        await server.addExperiment('exp');
        const user = userEvent.setup();
        const first = await renderAsync(run(newClient(server), {}));
        await screen.findByRole('button', { name: 'Done a' });
        first.unmount();
        await renderAsync(run(newClient(server), {}));

        await user.click(await screen.findByRole('button', { name: 'Resume' }));
        await user.click(await screen.findByRole('button', { name: 'Done a' }));
        await user.click(await screen.findByRole('button', { name: 'Done b' }));

        expect(await screen.findByText('The end')).toBeInTheDocument();
        await expect(server.storedLogs()).resolves.toMatchObject([
          { number: 1, values: { taskId: 'a' } },
          { number: 2, values: { taskId: 'b' } },
        ]);
      },
    );

    // Each level depends on every earlier answer, which only the timeline
    // remembers.
    function* staircase(): Generator<
      { type: string; id: string; level: number },
      void,
      Record<string, unknown> | undefined
    > {
      let level = 1;
      for (let trial = 1; trial <= 3; trial++) {
        const result = yield { type: 'trial', id: `t${trial}`, level };
        level += result?.correct === true ? 1 : -1;
      }
    }
    function StairTask() {
      const { task, completeTask } = useTask('trial');
      const addNote = useLogger('note');
      return (
        <>
          <p>
            {String(task.id)} at level {String(task.level)}
          </p>
          <button onClick={() => completeTask({ correct: true })}>Right</button>
          <button onClick={() => addNote({ text: String(task.id) })}>
            Note
          </button>
        </>
      );
    }
    const stairElements = { ...elements, tasks: { trial: <StairTask /> } };

    async function* asyncStaircase() {
      yield* staircase();
    }

    serverTest.for([
      ['sync', staircase],
      ['async', asyncStaircase],
    ] as const)(
      'replays a %s timeline with the logged results, reaching the same next task',
      async ([, makeTimeline], { server }) => {
        await server.addExperiment('exp');
        const user = userEvent.setup();
        const first = await renderAsync(
          run(newClient(server), {
            timeline: makeTimeline(),
            elements: stairElements,
          }),
        );
        await user.click(await screen.findByRole('button', { name: 'Right' }));
        await screen.findByText('t2 at level 2');
        await user.click(screen.getByRole('button', { name: 'Right' }));
        await screen.findByText('t3 at level 3');
        // The participant abandons t3 after it logged something.
        await user.click(screen.getByRole('button', { name: 'Note' }));
        await vi.waitFor(async () => {
          expect(await server.storedLogs()).toHaveLength(3);
        });
        first.unmount();

        await renderAsync(
          run(newClient(server), {
            timeline: makeTimeline(),
            elements: stairElements,
          }),
        );
        await user.click(await screen.findByRole('button', { name: 'Resume' }));

        expect(await screen.findByText('t3 at level 3')).toBeVisible();
        await user.click(screen.getByRole('button', { name: 'Right' }));
        expect(await screen.findByText('The end')).toBeInTheDocument();
        // t3 restarted: its note was canceled.
        await expect(server.storedLogs()).resolves.toMatchObject([
          { number: 1, type: 'trial', values: { taskId: 't1', correct: true } },
          { number: 2, type: 'trial', values: { taskId: 't2', correct: true } },
          { number: 3, type: 'trial', values: { taskId: 't3', correct: true } },
        ]);
      },
    );

    serverTest(
      'gives the timeline the same value when a task completes without a result, live or replayed',
      async ({ server }) => {
        await server.addExperiment('exp');
        const received: unknown[] = [];
        function* recording() {
          received.push(yield { type: 'trial', id: 'a' });
          received.push(yield { type: 'trial', id: 'b' });
        }
        const user = userEvent.setup();
        const first = await renderAsync(
          run(newClient(server), { timeline: recording() }),
        );
        await user.click(await screen.findByRole('button', { name: 'Done a' }));
        await screen.findByRole('button', { name: 'Done b' });
        await vi.waitFor(async () => {
          expect(await server.storedLogs()).toHaveLength(1);
        });
        first.unmount();
        const live = received.splice(0);

        await renderAsync(run(newClient(server), { timeline: recording() }));
        await user.click(await screen.findByRole('button', { name: 'Resume' }));
        await screen.findByRole('button', { name: 'Done b' });

        expect(received).toEqual(live);
      },
    );

    describe('when the timeline does not match the completion logs', () => {
      beforeEach(() => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
      });

      function OtherTask() {
        const { task } = useTask();
        return <p>Other {String(task.id)}</p>;
      }
      const mismatchElements = {
        ...elements,
        tasks: { ...elements.tasks, other: <OtherTask /> },
      };

      serverTest.for([
        [
          'a task id changed',
          [
            { type: 'trial', id: 'a' },
            { type: 'trial', id: 'x' },
          ],
        ],
        [
          'a task type changed',
          [
            { type: 'trial', id: 'a' },
            { type: 'other', id: 'b' },
          ],
        ],
        [
          'the timeline ends before the last logged task',
          [{ type: 'trial', id: 'a' }],
        ],
        [
          'a later task reuses a logged id',
          [
            { type: 'trial', id: 'a' },
            { type: 'trial', id: 'b' },
            { type: 'trial', id: 'a' },
          ],
        ],
      ] as const)(
        'shows TIMELINE_MISMATCH and interrupts the run when %s',
        async ([, changed], { server }) => {
          await server.addExperiment('exp');
          const user = userEvent.setup();
          const first = await renderAsync(
            run(newClient(server), {
              timeline: [
                { type: 'trial', id: 'a' },
                { type: 'trial', id: 'b' },
                { type: 'trial', id: 'c' },
              ],
              elements: mismatchElements,
            }),
          );
          await user.click(
            await screen.findByRole('button', { name: 'Done a' }),
          );
          await user.click(
            await screen.findByRole('button', { name: 'Done b' }),
          );
          await screen.findByRole('button', { name: 'Done c' });
          await vi.waitFor(async () => {
            expect(await server.storedLogs()).toHaveLength(2);
          });
          first.unmount();

          await renderAsync(
            run(newClient(server), {
              timeline: changed,
              elements: mismatchElements,
            }),
          );
          await user.click(
            await screen.findByRole('button', { name: 'Resume' }),
          );

          expect(await screen.findByText(/unexpected error/)).toBeVisible();
          expect(screen.getByRole('group')).toHaveTextContent(
            'Code: TIMELINE_MISMATCH',
          );
          expect(screen.queryByRole('button', { name: /Done/ })).toBeNull();
          expect(screen.queryByText(/Other/)).toBeNull();
          await vi.waitFor(async () => {
            await expect(server.storedRuns()).resolves.toEqual([
              { runName: 'run-1', runStatus: 'interrupted' },
            ]);
          });
          await expect(server.storedLogs()).resolves.toHaveLength(2);
        },
      );
    });

    serverTest(
      'sends one resume request when the participant double-clicks or StrictMode renders twice',
      async ({ server }) => {
        await server.addExperiment('exp');
        await leaveRunAfterFirstTask(server);
        const user = userEvent.setup();
        await renderAsync(
          <React.StrictMode>{run(newClient(server), {})}</React.StrictMode>,
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

  describe('remounts and identity', () => {
    beforeEach(() => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    serverTest(
      'crashes and interrupts the run when remounted after the start',
      async ({ server }) => {
        await server.addExperiment('exp');
        const client = newClient(server);
        const user = userEvent.setup();
        const first = await renderAsync(run(client, {}));
        await user.click(await screen.findByRole('button', { name: 'Done a' }));
        await screen.findByRole('button', { name: 'Done b' });
        first.unmount();

        await renderAsync(run(client, {}));

        expect(
          await screen.findByText(
            'The experiment stopped because of an error in its code. Please tell the experimenter. Reloading the page may let you continue.',
          ),
        ).toBeVisible();
        expect(screen.queryByRole('button')).toBeNull();
        const details = screen.getByRole('group');
        expect(details).toHaveTextContent('Code: RUN_REMOUNTED');
        expect(details).toHaveTextContent(/remounted after the run started/);
        expect(details).toHaveTextContent(/Keep `Run` mounted/);
        expect(details).toHaveTextContent(/Reloading the page resumes the run/);
        await vi.waitFor(async () => {
          await expect(server.storedRuns()).resolves.toEqual([
            { runName: 'run-1', runStatus: 'interrupted' },
          ]);
        });
        await expect(server.storedLogs()).resolves.toMatchObject([
          { number: 1, values: { taskId: 'a' } },
        ]);
      },
    );

    serverTest.for(['client', 'experimentName', 'runName'] as const)(
      'crashes and interrupts the run when %s changes after the start',
      async (prop, { server }) => {
        await server.addExperiment('exp');
        await server.addExperiment('other');
        const client = newClient(server);
        const user = userEvent.setup();
        const { rerender } = await renderAsync(run(client, {}));
        await user.click(await screen.findByRole('button', { name: 'Done a' }));
        await screen.findByRole('button', { name: 'Done b' });

        const changes = {
          client: { client: newClient(server) },
          experimentName: { experimentName: 'other' },
          runName: { runName: 'run-2' },
        };
        await act(async () => {
          rerender(run(client, changes[prop]));
        });

        expect(await screen.findByText(/error in its code/)).toBeVisible();
        expect(screen.queryByRole('button', { name: /Done/ })).toBeNull();
        await vi.waitFor(async () => {
          await expect(server.storedRuns()).resolves.toEqual([
            { runName: 'run-1', runStatus: 'interrupted' },
          ]);
        });
        expect(server.requestCount('POST', '/runs')).toBe(1);
      },
    );

    serverTest(
      'crashes the run when a second Run with the same identity mounts after the start',
      async ({ server }) => {
        await server.addExperiment('exp');
        const client = newClient(server);
        const { rerender } = await renderAsync(run(client, {}));
        await screen.findByRole('button', { name: 'Done a' });

        await act(async () => {
          rerender(
            <>
              {run(client, {})}
              {run(client, {})}
            </>,
          );
        });

        expect(await screen.findAllByText(/error in its code/)).toHaveLength(2);
        expect(screen.queryByRole('button', { name: /Done/ })).toBeNull();
        await vi.waitFor(async () => {
          await expect(server.storedRuns()).resolves.toEqual([
            { runName: 'run-1', runStatus: 'interrupted' },
          ]);
        });
      },
    );

    serverTest('plays the run through under StrictMode', async ({ server }) => {
      await server.addExperiment('exp');
      const user = userEvent.setup();
      await renderAsync(
        <React.StrictMode>{run(newClient(server), {})}</React.StrictMode>,
      );

      await user.click(await screen.findByRole('button', { name: 'Done a' }));
      await user.click(await screen.findByRole('button', { name: 'Done b' }));

      expect(await screen.findByText('The end')).toBeVisible();
      await expect(server.storedRuns()).resolves.toEqual([
        { runName: 'run-1', runStatus: 'completed' },
      ]);
    });

    serverTest(
      'starts the run when remounted during the lookup',
      async ({ server }) => {
        await server.addExperiment('exp');
        const client = newClient(server);
        const first = await renderAsync(run(client, {}));
        first.unmount();

        await renderAsync(run(client, {}));

        expect(
          await screen.findByRole('button', { name: 'Done a' }),
        ).toBeVisible();
        expect(server.requestCount('POST', '/runs')).toBe(1);
      },
    );

    // Leaves a run ongoing on the server, so that the next client of the same
    // session finds it, like a reload does.
    async function leaveRun(server: TestServer) {
      const page = await renderAsync(run(newClient(server), {}));
      await screen.findByRole('button', { name: 'Done a' });
      page.unmount();
    }

    serverTest(
      'resumes the run when remounted during the resume prompt',
      async ({ server }) => {
        await server.addExperiment('exp');
        await leaveRun(server);
        const client = newClient(server);
        const user = userEvent.setup();
        const prompt = await renderAsync(run(client, {}));
        await screen.findByRole('button', { name: 'Resume' });
        prompt.unmount();

        await renderAsync(run(client, {}));
        await user.click(await screen.findByRole('button', { name: 'Resume' }));

        expect(
          await screen.findByRole('button', { name: 'Done a' }),
        ).toBeVisible();
      },
    );

    serverTest(
      'switches to the new identity when the client changes during the resume prompt',
      async ({ server }) => {
        await server.addExperiment('exp');
        await leaveRun(server);
        const user = userEvent.setup();
        const { rerender } = await renderAsync(run(newClient(server), {}));
        await screen.findByRole('button', { name: 'Resume' });

        await act(async () => {
          rerender(run(newClient(server), {}));
        });
        await user.click(await screen.findByRole('button', { name: 'Resume' }));

        expect(
          await screen.findByRole('button', { name: 'Done a' }),
        ).toBeVisible();
        expect(server.requestCount('GET', '/runs')).toBe(2);
      },
    );
  });
});
