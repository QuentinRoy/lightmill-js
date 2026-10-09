/* eslint-disable react/display-name */
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEventPackage from '@testing-library/user-event';
import * as React from 'react';
import {
  LogDeliveryError,
  resumeAfter,
  TimelinePlayer,
  type TimelinePlayerElements,
  useLogger,
  useTask,
} from '../src/main.js';

// @ts-expect-error - userEventPackage is not typed correctly
const userEvent: typeof userEventPackage.default = userEventPackage;

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class ErrorBoundary extends React.Component<
  { children: React.ReactNode; onError?: (error: Error) => void },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    this.props.onError?.(error);
  }
  render() {
    return this.state.error == null ? (
      this.props.children
    ) : (
      <div data-testid="error">{this.state.error.message}</div>
    );
  }
}

type Task = { type: 'A'; a: string } | { type: 'B'; b: number };

describe('TimelinePlayer', () => {
  let Task: (props: { type: string; dataProp: string }) => React.ReactElement;
  const asyncTaskGen = async function* (
    taskLoadingTime: number,
    tasks: Task[],
  ) {
    for (let task of tasks) {
      await wait(taskLoadingTime);
      yield task;
    }
    await wait(taskLoadingTime);
  };

  beforeEach(() => {
    Task = ({ type, dataProp }: { type: string; dataProp: string }) => {
      let { task, onTaskCompleted } = useTask(type);
      return (
        <div>
          <h1>Type {task.type}</h1>
          <p data-testid="data">{task[dataProp] as string}</p>
          <input aria-label="Notes" />
          <button onClick={onTaskCompleted}>Complete</button>
        </div>
      );
    };
  });

  it('renders tasks in accordance with the timeline', async () => {
    const user = userEvent.setup();
    let config: TimelinePlayerElements<Task> = {
      tasks: {
        A: <Task type="A" dataProp="a" />,
        B: <Task type="B" dataProp="b" />,
      },
      completed: <div data-testid="end" />,
    };
    render(
      <TimelinePlayer
        elements={config}
        timeline={[
          { type: 'A', a: 'hello' },
          { type: 'B', b: 42 },
          { type: 'A', a: 'world' },
        ]}
      />,
    );
    expect(screen.getByRole('heading')).toHaveTextContent('Type A');
    expect(screen.getByTestId('data')).toHaveTextContent('hello');
    await user.click(screen.getByRole('button'));
    expect(screen.getByRole('heading')).toHaveTextContent('Type B');
    expect(screen.getByTestId('data')).toHaveTextContent('42');
    await user.click(screen.getByRole('button'));
    expect(screen.getByRole('heading')).toHaveTextContent('Type A');
    expect(screen.getByTestId('data')).toHaveTextContent('world');
    await user.click(screen.getByRole('button'));
    expect(screen.getByTestId('end')).toBeInTheDocument();
  });

  it('mounts each task fresh, even when consecutive tasks have the same type', async () => {
    const user = userEvent.setup();
    render(
      <TimelinePlayer
        elements={{ tasks: { A: <Task type="A" dataProp="a" /> } }}
        timeline={[
          { type: 'A', a: 'one' },
          { type: 'A', a: 'two' },
        ]}
      />,
    );
    await user.type(screen.getByRole('textbox'), 'typed');
    await user.click(screen.getByRole('button'));
    expect(screen.getByTestId('data')).toHaveTextContent('two');
    expect(screen.getByRole('textbox')).toHaveValue('');
  });

  it('starts after the task matched by resumeAfter', async () => {
    const user = userEvent.setup();
    render(
      <TimelinePlayer
        elements={{
          tasks: {
            A: <Task type="A" dataProp="a" />,
            B: <Task type="B" dataProp="b" />,
          },
          completed: <div data-testid="end" />,
        }}
        timeline={resumeAfter(
          [
            { type: 'A', a: 'hello' },
            { type: 'B', b: 42 },
            { type: 'B', b: 21 },
            { type: 'B', b: 12 },
            { type: 'A', a: 'world' },
          ] as Task[],
          (task) => task.type === 'B' && task.b === 21,
        )}
      />,
    );

    expect(screen.getByRole('heading')).toHaveTextContent('Type B');
    expect(screen.getByTestId('data')).toHaveTextContent('12');
    await user.click(screen.getByRole('button'));
    expect(screen.getByRole('heading')).toHaveTextContent('Type A');
    expect(screen.getByTestId('data')).toHaveTextContent('world');
    await user.click(screen.getByRole('button'));
    expect(screen.getByTestId('end')).toBeInTheDocument();
  });

  it('still supports the deprecated resumeAfterTask prop', async () => {
    const user = userEvent.setup();
    render(
      <TimelinePlayer
        elements={{
          tasks: {
            A: <Task type="A" dataProp="a" />,
            B: <Task type="B" dataProp="b" />,
          },
          completed: <div data-testid="end" />,
        }}
        timeline={
          [
            { type: 'A', a: 'hello' },
            { type: 'B', b: 42 },
            { type: 'A', a: 'world' },
          ] as Task[]
        }
        resumeAfterTask={(task) => task.type === 'B' && task.b === 42}
      />,
    );

    expect(screen.getByTestId('data')).toHaveTextContent('world');
    await user.click(screen.getByRole('button'));
    expect(screen.getByTestId('end')).toBeInTheDocument();
  });

  it('starts after the first task if resumeAfter matches it', async () => {
    render(
      <TimelinePlayer
        elements={{
          tasks: {
            A: <Task type="A" dataProp="a" />,
            B: <Task type="B" dataProp="b" />,
          },
        }}
        timeline={resumeAfter(
          [
            { type: 'B', b: 42 },
            { type: 'A', a: 'hello' },
          ] as Task[],
          (task) => task.type === 'B',
        )}
      />,
    );

    expect(screen.getByRole('heading')).toHaveTextContent('Type A');
    expect(screen.getByTestId('data')).toHaveTextContent('hello');
  });

  it('resumes an async timeline after the task matched by resumeAfter', async () => {
    const user = userEvent.setup();
    render(
      <TimelinePlayer
        elements={{
          tasks: {
            A: <Task type="A" dataProp="a" />,
            B: <Task type="B" dataProp="b" />,
          },
          loading: <div data-testid="loading" />,
          completed: <div data-testid="end" />,
        }}
        timeline={resumeAfter(
          asyncTaskGen(5, [
            { type: 'A', a: 'hello' },
            { type: 'B', b: 42 },
            { type: 'B', b: 21 },
            { type: 'B', b: 12 },
          ]),
          (task) => task.type === 'B' && task.b === 21,
        )}
      />,
    );

    expect(screen.getByTestId('loading')).toBeInTheDocument();
    expect(await screen.findByRole('heading')).toHaveTextContent('Type B');
    expect(screen.getByTestId('data')).toHaveTextContent('12');
    await user.click(screen.getByRole('button'));
    expect(await screen.findByTestId('end')).toBeInTheDocument();
  });

  it('renders nothing when the experiment is done if no completed element is provided', async () => {
    const user = userEvent.setup();
    let config: TimelinePlayerElements<Task> = {
      tasks: {
        A: <Task type="A" dataProp="a" />,
        B: <Task type="B" dataProp="b" />,
      },
    };
    let { container } = render(
      <TimelinePlayer
        elements={config}
        timeline={[
          { type: 'A', a: 'hello' },
          { type: 'B', b: 42 },
          { type: 'A', a: 'world' },
        ]}
      />,
    );

    expect(screen.getByRole('heading')).toHaveTextContent('Type A');
    expect(screen.getByTestId('data')).toHaveTextContent('hello');
    await user.click(screen.getByRole('button'));
    expect(screen.getByRole('heading')).toHaveTextContent('Type B');
    expect(screen.getByTestId('data')).toHaveTextContent('42');
    await user.click(screen.getByRole('button'));
    expect(screen.getByRole('heading')).toHaveTextContent('Type A');
    expect(screen.getByTestId('data')).toHaveTextContent('world');
    await user.click(screen.getByRole('button'));
    expect(container).toBeEmptyDOMElement();
  });

  it('renders loading if getting to the next step is asynchronous', async () => {
    vi.useFakeTimers();
    const taskTime = 150;
    let config: TimelinePlayerElements<Task> = {
      tasks: {
        A: <Task type="A" dataProp="a" />,
        B: <Task type="B" dataProp="b" />,
      },
      loading: <div data-testid="loading" />,
      completed: <div data-testid="end" />,
    };
    render(
      <TimelinePlayer
        elements={config}
        timeline={asyncTaskGen(taskTime, [
          { type: 'A', a: 'hello' },
          { type: 'B', b: 42 },
          { type: 'A', a: 'world' },
        ])}
      />,
    );
    expect(screen.getByTestId('loading')).toBeInTheDocument();
    await act(() => vi.advanceTimersByTime(taskTime));
    expect(screen.getByRole('heading')).toHaveTextContent('Type A');
    expect(screen.getByTestId('data')).toHaveTextContent('hello');
    expect(screen.getByRole('button')).toBeInTheDocument();
    // Use fireEvent instead of userEvent because userEvent doesn't work with
    // fake timers.
    fireEvent.click(screen.getByRole('button'));
    await act(() => vi.runAllTicks());
    expect(screen.getByTestId('loading')).toBeInTheDocument();
    await act(() => vi.advanceTimersByTime(taskTime));
    expect(screen.getByRole('heading')).toHaveTextContent('Type B');
    expect(screen.getByTestId('data')).toHaveTextContent('42');
    fireEvent.click(screen.getByRole('button'));
    await act(() => vi.runAllTicks());
    expect(screen.getByTestId('loading')).toBeInTheDocument();
    await act(() => vi.advanceTimersByTime(taskTime));
    expect(screen.getByRole('heading')).toHaveTextContent('Type A');
    expect(screen.getByTestId('data')).toHaveTextContent('world');
    await act(() => vi.advanceTimersByTime(taskTime));
    fireEvent.click(screen.getByRole('button'));
    await act(() => vi.runAllTicks());
    expect(screen.getByTestId('loading')).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTime(taskTime);
      await vi.runAllTicks();
    });
    expect(screen.getByTestId('end')).toBeInTheDocument();
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('let timeline being undefined as long as loading is true', async () => {
    const user = userEvent.setup();
    const tasks: Task[] = [
      { type: 'A', a: 'hello' },
      { type: 'B', b: 42 },
      { type: 'A', a: 'world' },
    ];
    let config: TimelinePlayerElements<Task> = {
      tasks: {
        A: <Task type="A" dataProp="a" />,
        B: <Task type="B" dataProp="b" />,
      },
      loading: <div data-testid="loading" />,
      completed: <div data-testid="end" />,
    };

    const { rerender } = render(<TimelinePlayer elements={config} loading />);
    expect(screen.getByTestId('loading')).toBeInTheDocument();
    rerender(<TimelinePlayer elements={config} loading timeline={tasks} />);
    expect(screen.getByTestId('loading')).toBeInTheDocument();

    rerender(<TimelinePlayer elements={config} timeline={tasks} />);
    expect(screen.getByRole('heading')).toHaveTextContent('Type A');
    expect(screen.getByTestId('data')).toHaveTextContent('hello');
    await user.click(screen.getByText('Complete'));
    expect(screen.getByRole('heading')).toHaveTextContent('Type B');
    expect(screen.getByTestId('data')).toHaveTextContent('42');

    rerender(<TimelinePlayer elements={config} timeline={tasks} loading />);
    expect(screen.getByRole('heading')).toHaveTextContent('Type B');
    expect(screen.queryByTestId('loading')).not.toBeInTheDocument();

    rerender(<TimelinePlayer elements={config} timeline={tasks} />);
    expect(screen.getByRole('heading')).toHaveTextContent('Type B');
    expect(screen.getByTestId('data')).toHaveTextContent('42');
    await user.click(screen.getByText('Complete'));
    expect(screen.getByRole('heading')).toHaveTextContent('Type A');
    expect(screen.getByTestId('data')).toHaveTextContent('world');
    await user.click(screen.getByText('Complete'));
    expect(screen.getByTestId('end')).toBeInTheDocument();
  });

  it('completes right away on an empty sync timeline, calling onCompleted once', () => {
    const onCompleted = vi.fn();
    render(
      <React.StrictMode>
        <TimelinePlayer
          elements={{
            tasks: {
              A: <Task type="A" dataProp="a" />,
              B: <Task type="B" dataProp="b" />,
            },
            completed: <div data-testid="end" />,
          }}
          timeline={[]}
          onCompleted={onCompleted}
        />
      </React.StrictMode>,
    );
    expect(screen.getByTestId('end')).toBeInTheDocument();
    expect(onCompleted).toHaveBeenCalledOnce();
  });

  it('throws if the timeline is unset again', () => {
    const elements = {
      tasks: {
        A: <Task type="A" dataProp="a" />,
        B: <Task type="B" dataProp="b" />,
      },
    };
    const timeline: Task[] = [{ type: 'A', a: 'hello' }];
    const { rerender } = render(<TimelinePlayer elements={elements} loading />);
    rerender(
      <TimelinePlayer elements={elements} loading timeline={timeline} />,
    );
    const spy = vi.spyOn(console, 'error');
    spy.mockImplementation(() => {});
    expect(() => {
      rerender(<TimelinePlayer elements={elements} loading />);
    }).toThrow('Timeline cannot be changed once set');
    spy.mockRestore();
  });

  it('throws an error if the timeline is changed', async () => {
    const elements = {
      tasks: {
        A: <Task type="A" dataProp="a" />,
        B: <Task type="B" dataProp="b" />,
      },
    };
    const { rerender } = render(
      <TimelinePlayer
        elements={elements}
        timeline={[{ type: 'A', a: 'hello' }]}
      />,
    );
    expect(screen.getByRole('heading')).toHaveTextContent('Type A');

    const spy = vi.spyOn(console, 'error');
    spy.mockImplementation(() => {});

    expect(() => {
      rerender(
        <TimelinePlayer
          elements={elements}
          timeline={[{ type: 'A', a: 'world' }]}
        />,
      );
    }).toThrow('Timeline cannot be changed once set');

    spy.mockRestore();
  });

  it('throws if no task matches resumeAfter', async () => {
    const spy = vi.spyOn(console, 'error');
    spy.mockImplementation(() => {});
    expect(() => {
      render(
        <TimelinePlayer
          elements={{
            tasks: {
              A: <Task type="A" dataProp="a" />,
              B: <Task type="B" dataProp="b" />,
            },
            completed: <div data-testid="end" />,
          }}
          timeline={resumeAfter(
            [
              { type: 'A', a: 'hello' },
              { type: 'B', b: 42 },
              { type: 'B', b: 21 },
              { type: 'B', b: 12 },
              { type: 'A', a: 'world' },
            ] as Task[],
            (task) => task.type === 'B' && task.b === 0,
          )}
        />,
      );
    }).toThrow('No task matched');
    spy.mockRestore();
  });

  it('throws if no task of an async timeline matches resumeAfter', async () => {
    const spy = vi.spyOn(console, 'error');
    spy.mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <TimelinePlayer
          elements={{
            tasks: {
              A: <Task type="A" dataProp="a" />,
              B: <Task type="B" dataProp="b" />,
            },
          }}
          timeline={resumeAfter(
            asyncTaskGen(5, [
              { type: 'A', a: 'hello' },
              { type: 'B', b: 42 },
            ]),
            (task) => task.type === 'B' && task.b === 0,
          )}
        />
      </ErrorBoundary>,
    );
    expect(await screen.findByTestId('error')).toHaveTextContent(
      'No task matched',
    );
    spy.mockRestore();
  });

  it('keeps a non-Error thrown by the timeline as the error cause', async () => {
    const spy = vi.spyOn(console, 'error');
    spy.mockImplementation(() => {});
    const onError = vi.fn();
    render(
      <ErrorBoundary onError={onError}>
        <TimelinePlayer
          elements={{
            tasks: {
              A: <Task type="A" dataProp="a" />,
              B: <Task type="B" dataProp="b" />,
            },
          }}
          timeline={{
            next: () => {
              throw 'nope';
            },
          }}
        />
      </ErrorBoundary>,
    );
    expect(await screen.findByTestId('error')).toHaveTextContent('nope');
    expect(onError.mock.lastCall?.[0].cause).toBe('nope');
    spy.mockRestore();
  });

  it('throws an error if the same task is completed multiple times', async () => {
    const wrapper = vi.fn(
      (f: () => void, { shouldFail }: { shouldFail: boolean }) => {
        if (shouldFail) {
          try {
            expect(() => f()).toThrowErrorMatchingInlineSnapshot(
              `[Error: Task already completed]`,
            );
          } catch (_e) {
            // Nothing to do.
          }
        } else {
          f();
        }
      },
    );
    const BadTask = () => {
      let { onTaskCompleted } = useTask('bad');
      return (
        <div>
          <h1>Bad Task</h1>
          <button
            onClick={() => {
              wrapper(onTaskCompleted, { shouldFail: false });
              wrapper(onTaskCompleted, { shouldFail: true });
            }}
          >
            Complete
          </button>
        </div>
      );
    };
    let config = {
      tasks: { bad: <BadTask />, ok: <Task type="ok" dataProp="prop" /> },
    };
    render(
      <TimelinePlayer
        elements={config}
        timeline={[{ type: 'bad' }, { type: 'ok', prop: 'hello' }]}
      />,
    );
    expect(screen.getByRole('heading')).toHaveTextContent('Bad Task');
    fireEvent.click(screen.getByRole('button'));
    expect(wrapper).toHaveBeenCalledTimes(2);
  });

  it('throws when a held logger is called after onLog is removed', async () => {
    const user = userEvent.setup();
    const spy = vi.spyOn(console, 'error');
    spy.mockImplementation(() => {});
    const timeline = [{ type: 'A' }];
    let heldLog: ((log: { type: string }) => void) | undefined;
    const LogTask = () => {
      heldLog = useLogger();
      const { onTaskCompleted } = useTask();
      return <button onClick={onTaskCompleted}>Complete</button>;
    };
    const onError = vi.fn();
    const element = (onLog?: () => Promise<void>) => (
      <ErrorBoundary onError={onError}>
        <TimelinePlayer
          elements={{ tasks: { A: <LogTask /> }, completed: <div /> }}
          timeline={timeline}
          onLog={onLog}
        />
      </ErrorBoundary>
    );
    const { rerender } = render(element(() => Promise.resolve()));
    await user.click(screen.getByText('Complete'));
    rerender(element());
    act(() => heldLog?.({ type: 'L' }));
    expect(screen.getByTestId('error')).toHaveTextContent(
      'Could not add log: onLog was removed from <TimelinePlayer />',
    );
    const error = onError.mock.lastCall?.[0];
    expect(error).toBeInstanceOf(LogDeliveryError);
    expect(error.log).toEqual({ type: 'L' });
    spy.mockRestore();
  });

  describe('StrictMode', () => {
    const tasks = [
      { type: 'A', a: 'one' },
      { type: 'A', a: 'two' },
      { type: 'A', a: 'three' },
    ] as const;
    // Records every task the timeline is asked for, to catch tasks pulled
    // twice or lost.
    const syncGen = function* (pulled: string[]) {
      for (const task of tasks) {
        pulled.push(task.a);
        yield task;
      }
    };
    const asyncGen = async function* (pulled: string[]) {
      for (const task of tasks) {
        await wait(5);
        pulled.push(task.a);
        yield task;
      }
    };

    it.each([
      { name: 'sync', gen: syncGen, resume: false },
      { name: 'sync', gen: syncGen, resume: true },
      { name: 'async', gen: asyncGen, resume: false },
      { name: 'async', gen: asyncGen, resume: true },
    ])(
      'renders every task once, in order ($name timeline, resumeAfter: $resume)',
      async ({ gen, resume }) => {
        const user = userEvent.setup();
        const pulled: string[] = [];
        const onCompleted = vi.fn();
        const timeline = resume
          ? resumeAfter(
              gen(pulled),
              (task) => task.type === 'A' && task.a === 'one',
            )
          : gen(pulled);
        render(
          <React.StrictMode>
            <TimelinePlayer
              elements={{
                tasks: { A: <Task type="A" dataProp="a" /> },
                loading: <div data-testid="loading" />,
                completed: <div data-testid="end" />,
              }}
              timeline={timeline}
              onCompleted={onCompleted}
            />
          </React.StrictMode>,
        );
        const expected = resume ? ['two', 'three'] : ['one', 'two', 'three'];
        for (const a of expected) {
          expect(await screen.findByTestId('data')).toHaveTextContent(a);
          await user.click(screen.getByText('Complete'));
        }
        expect(await screen.findByTestId('end')).toBeInTheDocument();
        expect(pulled).toEqual(['one', 'two', 'three']);
        expect(onCompleted).toHaveBeenCalledOnce();
      },
    );

    it('does not call onCompleted when the timeline completes after unmount', async () => {
      vi.useFakeTimers();
      const onCompleted = vi.fn();
      const { unmount } = render(
        <TimelinePlayer
          elements={{
            tasks: {
              A: <Task type="A" dataProp="a" />,
              B: <Task type="B" dataProp="b" />,
            },
          }}
          timeline={asyncTaskGen(5, [])}
          onCompleted={onCompleted}
        />,
      );
      unmount();
      await act(() => vi.advanceTimersByTime(50));
      expect(onCompleted).not.toHaveBeenCalled();
      vi.useRealTimers();
    });

    it('calls onCompleted once TimelinePlayer is shown again if the timeline completed while it was hidden', async () => {
      vi.useFakeTimers();
      const onCompleted = vi.fn();
      const ui = (mode: 'visible' | 'hidden') => (
        <React.Activity mode={mode}>
          <TimelinePlayer
            elements={{
              tasks: {
                A: <Task type="A" dataProp="a" />,
                B: <Task type="B" dataProp="b" />,
              },
            }}
            timeline={timeline}
            onCompleted={onCompleted}
          />
        </React.Activity>
      );
      const timeline = asyncTaskGen(5, []);
      const { rerender } = render(ui('visible'));
      rerender(ui('hidden'));
      await act(() => vi.advanceTimersByTime(50));
      expect(onCompleted).not.toHaveBeenCalled();
      rerender(ui('visible'));
      expect(onCompleted).toHaveBeenCalledOnce();
      vi.useRealTimers();
    });

    it('does not start anything when an async next() resolves after unmount', async () => {
      vi.useFakeTimers();
      const spy = vi.spyOn(console, 'error');
      spy.mockImplementation(() => {});
      const pulled: string[] = [];
      const { unmount } = render(
        <TimelinePlayer
          elements={{ tasks: { A: <Task type="A" dataProp="a" /> } }}
          timeline={asyncGen(pulled)}
        />,
      );
      unmount();
      await act(() => vi.advanceTimersByTime(50));
      expect(pulled).toEqual(['one']);
      expect(screen.queryByRole('heading')).not.toBeInTheDocument();
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
      vi.runOnlyPendingTimers();
      vi.useRealTimers();
    });
  });

  describe('remounting', () => {
    const tasks = [
      { type: 'A', a: 'one' },
      { type: 'A', a: 'two' },
      { type: 'A', a: 'three' },
    ] as const;
    const elements = () => ({
      tasks: {
        A: <Task type="A" dataProp="a" />,
        B: <Task type="B" dataProp="b" />,
      },
      loading: <div data-testid="loading" />,
      completed: <div data-testid="end" />,
    });
    const syncGen = function* (pulled: string[]) {
      for (const task of tasks) {
        pulled.push(task.a);
        yield task;
      }
    };
    const asyncGen = async function* (pulled: string[]) {
      for (const task of tasks) {
        await wait(5);
        pulled.push(task.a);
        yield task;
      }
    };

    it('continues a generator with the task in progress, neither skipping nor repeating tasks', async () => {
      const user = userEvent.setup();
      const pulled: string[] = [];
      const timeline = syncGen(pulled);
      const first = render(
        <TimelinePlayer elements={elements()} timeline={timeline} />,
      );
      await user.click(screen.getByText('Complete'));
      await user.type(screen.getByRole('textbox'), 'typed');
      first.unmount();

      render(<TimelinePlayer elements={elements()} timeline={timeline} />);

      expect(screen.getByTestId('data')).toHaveTextContent('two');
      // The task component starts afresh.
      expect(screen.getByRole('textbox')).toHaveValue('');
      await user.click(screen.getByText('Complete'));
      expect(screen.getByTestId('data')).toHaveTextContent('three');
      await user.click(screen.getByText('Complete'));
      expect(screen.getByTestId('end')).toBeInTheDocument();
      expect(pulled).toEqual(['one', 'two', 'three']);
    });

    it('continues an async generator remounted while next() is pending', async () => {
      const user = userEvent.setup();
      const pulled: string[] = [];
      const timeline = asyncGen(pulled);
      const first = render(
        <TimelinePlayer elements={elements()} timeline={timeline} />,
      );
      expect(screen.getByTestId('loading')).toBeInTheDocument();
      first.unmount();

      render(<TimelinePlayer elements={elements()} timeline={timeline} />);

      expect(screen.getByTestId('loading')).toBeInTheDocument();
      expect(await screen.findByTestId('data')).toHaveTextContent('one');
      await user.click(screen.getByText('Complete'));
      expect(await screen.findByTestId('data')).toHaveTextContent('two');
      expect(pulled).toEqual(['one', 'two']);
    });

    it('shows the completed element without replaying a completed timeline', async () => {
      const user = userEvent.setup();
      const next = vi
        .fn<() => IteratorResult<Task>>()
        .mockReturnValueOnce({ done: false, value: { type: 'A', a: 'one' } })
        .mockReturnValue({ done: true, value: undefined });
      const timeline = { next };
      const first = render(
        <TimelinePlayer elements={elements()} timeline={timeline} />,
      );
      await user.click(screen.getByText('Complete'));
      expect(screen.getByTestId('end')).toBeInTheDocument();
      first.unmount();

      render(<TimelinePlayer elements={elements()} timeline={timeline} />);

      expect(screen.getByTestId('end')).toBeInTheDocument();
      expect(next).toHaveBeenCalledTimes(2);
    });

    it('throws again the error the timeline ended with', () => {
      const spy = vi.spyOn(console, 'error');
      spy.mockImplementation(() => {});
      let calls = 0;
      const timeline = {
        next(): IteratorResult<Task> {
          if (calls++ === 0) throw new Error('boom');
          return { done: true, value: undefined };
        },
      };
      const ui = (
        <ErrorBoundary>
          <TimelinePlayer elements={elements()} timeline={timeline} />
        </ErrorBoundary>
      );
      const first = render(ui);
      expect(screen.getByTestId('error')).toHaveTextContent('boom');
      first.unmount();

      render(ui);

      expect(screen.getByTestId('error')).toHaveTextContent('boom');
      expect(calls).toBe(1);
      spy.mockRestore();
    });

    it('restarts an array timeline', async () => {
      const user = userEvent.setup();
      const timeline = [...tasks];
      const first = render(
        <TimelinePlayer elements={elements()} timeline={timeline} />,
      );
      await user.click(screen.getByText('Complete'));
      expect(screen.getByTestId('data')).toHaveTextContent('two');
      first.unmount();

      render(<TimelinePlayer elements={elements()} timeline={timeline} />);

      expect(screen.getByTestId('data')).toHaveTextContent('one');
    });

    it('starts a fresh pass of a re-iterable that is not an iterator', async () => {
      const user = userEvent.setup();
      const timeline = new Set(tasks);
      const first = render(
        <TimelinePlayer elements={elements()} timeline={timeline} />,
      );
      await user.click(screen.getByText('Complete'));
      first.unmount();

      render(<TimelinePlayer elements={elements()} timeline={timeline} />);

      expect(screen.getByTestId('data')).toHaveTextContent('one');
    });

    it('reads the timeline once under StrictMode', () => {
      const iterator = syncGen([]);
      const getIterator = vi.fn(() => iterator);
      const timeline = {
        next: () => iterator.next(),
        [Symbol.iterator]: getIterator,
      };
      render(
        <React.StrictMode>
          <TimelinePlayer elements={elements()} timeline={timeline} />
        </React.StrictMode>,
      );

      expect(screen.getByTestId('data')).toHaveTextContent('one');
      expect(getIterator).toHaveBeenCalledOnce();
    });

    it('ignores a later resumeAfterTask once the store exists', async () => {
      const user = userEvent.setup();
      const timeline = syncGen([]);
      const first = render(
        <TimelinePlayer
          elements={elements()}
          timeline={timeline}
          resumeAfterTask={(task) => task.a === 'one'}
        />,
      );
      expect(screen.getByTestId('data')).toHaveTextContent('two');
      first.unmount();

      render(
        <TimelinePlayer
          elements={elements()}
          timeline={timeline}
          resumeAfterTask={(task) => task.a === 'two'}
        />,
      );

      expect(screen.getByTestId('data')).toHaveTextContent('two');
      await user.click(screen.getByText('Complete'));
      expect(screen.getByTestId('data')).toHaveTextContent('three');
    });
  });

  describe('loading while a task is running', () => {
    const elements = () => ({
      tasks: {
        A: <Task type="A" dataProp="a" />,
        B: <Task type="B" dataProp="b" />,
      },
      loading: <div data-testid="loading" />,
      paused: <div data-testid="paused" />,
      completed: <div data-testid="end" />,
    });
    const timeline: Task[] = [
      { type: 'A', a: 'hello' },
      { type: 'B', b: 42 },
    ];

    it('keeps the running task, then renders elements.loading once it is completed', async () => {
      const user = userEvent.setup();
      const els = elements();
      const { rerender } = render(
        <TimelinePlayer elements={els} timeline={timeline} />,
      );
      rerender(<TimelinePlayer elements={els} timeline={timeline} loading />);
      expect(screen.getByRole('heading')).toHaveTextContent('Type A');
      await user.click(screen.getByText('Complete'));
      expect(screen.getByTestId('loading')).toBeInTheDocument();
      expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    });

    it('does not remount the task if loading ends before it is completed', async () => {
      const user = userEvent.setup();
      const els = elements();
      const { rerender } = render(
        <TimelinePlayer elements={els} timeline={timeline} />,
      );
      await user.type(screen.getByRole('textbox'), 'typed');
      rerender(<TimelinePlayer elements={els} timeline={timeline} loading />);
      rerender(<TimelinePlayer elements={els} timeline={timeline} />);
      expect(screen.getByRole('textbox')).toHaveValue('typed');
    });

    it('renders elements.loading instead of completed while loading', async () => {
      const user = userEvent.setup();
      const els = elements();
      const { rerender } = render(
        <TimelinePlayer elements={els} timeline={timeline} />,
      );
      await user.click(screen.getByText('Complete'));
      rerender(<TimelinePlayer elements={els} timeline={timeline} loading />);
      await user.click(screen.getByText('Complete'));
      expect(screen.getByTestId('loading')).toBeInTheDocument();
      rerender(<TimelinePlayer elements={els} timeline={timeline} />);
      expect(screen.getByTestId('end')).toBeInTheDocument();
    });

    it('renders elements.paused over elements.loading when both are set', async () => {
      const user = userEvent.setup();
      const els = elements();
      const { rerender } = render(
        <TimelinePlayer elements={els} timeline={timeline} />,
      );
      rerender(
        <TimelinePlayer elements={els} timeline={timeline} loading paused />,
      );
      expect(screen.getByRole('heading')).toHaveTextContent('Type A');
      await user.click(screen.getByText('Complete'));
      expect(screen.getByTestId('paused')).toBeInTheDocument();
      expect(screen.queryByTestId('loading')).not.toBeInTheDocument();
    });
  });

  describe('paused', () => {
    const paused = <div data-testid="paused" />;
    const elements = () => ({
      tasks: {
        A: <Task type="A" dataProp="a" />,
        B: <Task type="B" dataProp="b" />,
      },
      completed: <div data-testid="end" />,
      paused,
    });
    const timeline: Task[] = [
      { type: 'A', a: 'hello' },
      { type: 'B', b: 42 },
    ];
    const singleTaskTimeline = timeline.slice(0, 1);

    it('keeps the running task, then renders elements.paused once it is completed', async () => {
      const user = userEvent.setup();
      const els = elements();
      const { rerender } = render(
        <TimelinePlayer elements={els} timeline={timeline} />,
      );
      rerender(<TimelinePlayer elements={els} timeline={timeline} paused />);
      expect(screen.getByRole('heading')).toHaveTextContent('Type A');
      expect(screen.queryByTestId('paused')).not.toBeInTheDocument();
      await user.click(screen.getByText('Complete'));
      expect(screen.getByTestId('paused')).toBeInTheDocument();
      expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    });

    it('keeps the running task in StrictMode', async () => {
      const user = userEvent.setup();
      const els = elements();
      const { rerender } = render(
        <React.StrictMode>
          <TimelinePlayer elements={els} timeline={timeline} />
        </React.StrictMode>,
      );
      rerender(
        <React.StrictMode>
          <TimelinePlayer elements={els} timeline={timeline} paused />
        </React.StrictMode>,
      );
      expect(screen.getByRole('heading')).toHaveTextContent('Type A');
      expect(screen.queryByTestId('paused')).not.toBeInTheDocument();
      await user.click(screen.getByText('Complete'));
      expect(screen.getByTestId('paused')).toBeInTheDocument();
    });

    it('renders the next task once no longer paused', async () => {
      const user = userEvent.setup();
      const els = elements();
      const { rerender } = render(
        <TimelinePlayer elements={els} timeline={timeline} />,
      );
      rerender(<TimelinePlayer elements={els} timeline={timeline} paused />);
      await user.click(screen.getByText('Complete'));
      rerender(<TimelinePlayer elements={els} timeline={timeline} />);
      expect(screen.getByRole('heading')).toHaveTextContent('Type B');
    });

    it('resumes the task it kept if unpaused before it is completed', () => {
      const els = elements();
      const { rerender } = render(
        <TimelinePlayer elements={els} timeline={timeline} />,
      );
      rerender(<TimelinePlayer elements={els} timeline={timeline} paused />);
      rerender(<TimelinePlayer elements={els} timeline={timeline} />);
      expect(screen.getByRole('heading')).toHaveTextContent('Type A');
    });

    it('renders elements.paused right away if the pause starts while loading', () => {
      const els = elements();
      render(
        <TimelinePlayer elements={els} timeline={timeline} loading paused />,
      );
      expect(screen.getByTestId('paused')).toBeInTheDocument();
    });

    it('does not keep a task that starts after the pause did', async () => {
      vi.useFakeTimers();
      const els = elements();
      render(
        <TimelinePlayer
          elements={els}
          paused
          timeline={asyncTaskGen(100, [{ type: 'A', a: 'hello' }])}
        />,
      );
      expect(screen.getByTestId('paused')).toBeInTheDocument();
      await act(() => vi.advanceTimersByTime(100));
      expect(screen.getByTestId('paused')).toBeInTheDocument();
      expect(screen.queryByRole('heading')).not.toBeInTheDocument();
      vi.runOnlyPendingTimers();
      vi.useRealTimers();
    });

    it('renders elements.paused instead of completed and still calls onCompleted', async () => {
      const user = userEvent.setup();
      const onCompleted = vi.fn();
      const els = elements();
      const { rerender } = render(
        <TimelinePlayer
          elements={els}
          timeline={singleTaskTimeline}
          onCompleted={onCompleted}
        />,
      );
      rerender(
        <TimelinePlayer
          elements={els}
          timeline={singleTaskTimeline}
          onCompleted={onCompleted}
          paused
        />,
      );
      await user.click(screen.getByText('Complete'));
      expect(onCompleted).toHaveBeenCalledOnce();
      expect(screen.getByTestId('paused')).toBeInTheDocument();
      expect(screen.queryByTestId('end')).not.toBeInTheDocument();
    });

    it('renders elements.completed again once unpaused after the timeline completed', async () => {
      const user = userEvent.setup();
      const els = elements();
      const { rerender } = render(
        <TimelinePlayer elements={els} timeline={singleTaskTimeline} />,
      );
      rerender(
        <TimelinePlayer elements={els} timeline={singleTaskTimeline} paused />,
      );
      await user.click(screen.getByText('Complete'));
      expect(screen.getByTestId('paused')).toBeInTheDocument();
      rerender(<TimelinePlayer elements={els} timeline={singleTaskTimeline} />);
      expect(screen.getByTestId('end')).toBeInTheDocument();
    });

    it.each([false, true])(
      'still throws when onLog rejects (paused: %s)',
      async (paused) => {
        const user = userEvent.setup();
        const spy = vi.spyOn(console, 'error');
        spy.mockImplementation(() => {});
        const timeline = [{ type: 'A' }];
        const LogTask = () => {
          const log = useLogger();
          return <button onClick={() => log({ type: 'L' })}>Log</button>;
        };
        const onError = vi.fn();
        const element = (paused: boolean) => (
          <ErrorBoundary onError={onError}>
            <TimelinePlayer
              elements={{ tasks: { A: <LogTask /> }, paused: <div /> }}
              timeline={timeline}
              paused={paused}
              onLog={() => Promise.reject(new Error('nope'))}
            />
          </ErrorBoundary>
        );
        const { rerender } = render(element(false));
        // The running task stays rendered once paused.
        rerender(element(paused));
        await user.click(screen.getByText('Log'));
        expect(await screen.findByTestId('error')).toHaveTextContent(
          'Could not add log : nope',
        );
        const error = onError.mock.lastCall?.[0];
        expect(error).toBeInstanceOf(LogDeliveryError);
        expect(error.log).toEqual({ type: 'L' });
        spy.mockRestore();
      },
    );

    it('throws a LogDeliveryError if elements.paused is missing', () => {
      const spy = vi.spyOn(console, 'error');
      spy.mockImplementation(() => {});
      const { paused: _paused, ...withoutPaused } = elements();
      let error: unknown;
      try {
        render(
          <TimelinePlayer
            elements={withoutPaused}
            timeline={timeline}
            paused
          />,
        );
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(LogDeliveryError);
      expect(error).toHaveProperty(
        'message',
        expect.stringContaining('Logs could not be delivered'),
      );
      spy.mockRestore();
    });
  });
});
