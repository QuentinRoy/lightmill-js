/* eslint-disable react/display-name */
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEventPackage from '@testing-library/user-event';
import * as React from 'react';
import {
  LogDeliveryError,
  Run,
  type RunElements,
  useLogger,
  useTask,
} from '../src/main.js';

// @ts-expect-error - userEventPackage is not typed correctly
const userEvent: typeof userEventPackage.default = userEventPackage;

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
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

describe('run', () => {
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
          <button onClick={onTaskCompleted}>Complete</button>
        </div>
      );
    };
  });

  it('renders tasks in accordance with the timeline', async () => {
    const user = userEvent.setup();
    let config: RunElements<Task> = {
      tasks: {
        A: <Task type="A" dataProp="a" />,
        B: <Task type="B" dataProp="b" />,
      },
      completed: <div data-testid="end" />,
    };
    render(
      <Run
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

  it('starts with a later tasks if resumeAfter is provided', async () => {
    const user = userEvent.setup();
    render(
      <Run
        resumeAfter={{ type: 'B', number: 2 }}
        elements={{
          tasks: {
            A: <Task type="A" dataProp="a" />,
            B: <Task type="B" dataProp="b" />,
          },
          completed: <div data-testid="end" />,
        }}
        timeline={[
          { type: 'A', a: 'hello' },
          { type: 'B', b: 42 },
          { type: 'B', b: 21 },
          { type: 'B', b: 12 },
          { type: 'A', a: 'world' },
        ]}
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

  it('renders nothing when the experiment is done if no completed element is provided', async () => {
    const user = userEvent.setup();
    let config: RunElements<Task> = {
      tasks: {
        A: <Task type="A" dataProp="a" />,
        B: <Task type="B" dataProp="b" />,
      },
    };
    let { container } = render(
      <Run
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
    let config: RunElements<Task> = {
      tasks: {
        A: <Task type="A" dataProp="a" />,
        B: <Task type="B" dataProp="b" />,
      },
      loading: <div data-testid="loading" />,
      completed: <div data-testid="end" />,
    };
    render(
      <Run
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
    let config: RunElements<Task> = {
      tasks: {
        A: <Task type="A" dataProp="a" />,
        B: <Task type="B" dataProp="b" />,
      },
      loading: <div data-testid="loading" />,
      completed: <div data-testid="end" />,
    };

    const { rerender } = render(<Run elements={config} loading />);
    expect(screen.getByTestId('loading')).toBeInTheDocument();
    rerender(<Run elements={config} loading timeline={tasks} />);
    expect(screen.getByTestId('loading')).toBeInTheDocument();

    rerender(<Run elements={config} timeline={tasks} />);
    expect(screen.getByRole('heading')).toHaveTextContent('Type A');
    expect(screen.getByTestId('data')).toHaveTextContent('hello');
    await user.click(screen.getByText('Complete'));
    expect(screen.getByRole('heading')).toHaveTextContent('Type B');
    expect(screen.getByTestId('data')).toHaveTextContent('42');

    rerender(<Run elements={config} timeline={tasks} loading />);
    expect(screen.getByTestId('loading')).toBeInTheDocument();

    rerender(<Run elements={config} timeline={tasks} />);
    expect(screen.getByRole('heading')).toHaveTextContent('Type B');
    expect(screen.getByTestId('data')).toHaveTextContent('42');
    await user.click(screen.getByText('Complete'));
    expect(screen.getByRole('heading')).toHaveTextContent('Type A');
    expect(screen.getByTestId('data')).toHaveTextContent('world');
    await user.click(screen.getByText('Complete'));
    expect(screen.getByTestId('end')).toBeInTheDocument();
  });

  it('throws an error if the timeline is changed', async () => {
    const elements = {
      tasks: {
        A: <Task type="A" dataProp="a" />,
        B: <Task type="B" dataProp="b" />,
      },
    };
    const { rerender } = render(
      <Run elements={elements} timeline={[{ type: 'A', a: 'hello' }]} />,
    );
    expect(screen.getByRole('heading')).toHaveTextContent('Type A');

    const spy = vi.spyOn(console, 'error');
    spy.mockImplementation(() => {});

    expect(() => {
      rerender(
        <Run elements={elements} timeline={[{ type: 'A', a: 'world' }]} />,
      );
    }).toThrow('Timeline cannot be changed once set');

    spy.mockRestore();
  });

  it('throws an error if the run should resume after an non existing task', async () => {
    const spy = vi.spyOn(console, 'error');
    spy.mockImplementation(() => {});
    expect(() => {
      render(
        <Run
          resumeAfter={{ type: 'B', number: 4 }}
          elements={{
            tasks: {
              A: <Task type="A" dataProp="a" />,
              B: <Task type="B" dataProp="b" />,
            },
            completed: <div data-testid="end" />,
          }}
          timeline={[
            { type: 'A', a: 'hello' },
            { type: 'B', b: 42 },
            { type: 'B', b: 21 },
            { type: 'B', b: 12 },
            { type: 'A', a: 'world' },
          ]}
        />,
      );
    }).toThrow('Could not find task to resume after');
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
      <Run
        elements={config}
        timeline={[{ type: 'bad' }, { type: 'ok', prop: 'hello' }]}
      />,
    );
    expect(screen.getByRole('heading')).toHaveTextContent('Bad Task');
    fireEvent.click(screen.getByRole('button'));
    expect(wrapper).toHaveBeenCalledTimes(2);
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
      const { rerender } = render(<Run elements={els} timeline={timeline} />);
      rerender(<Run elements={els} timeline={timeline} paused />);
      expect(screen.getByRole('heading')).toHaveTextContent('Type A');
      expect(screen.queryByTestId('paused')).not.toBeInTheDocument();
      await user.click(screen.getByText('Complete'));
      expect(screen.getByTestId('paused')).toBeInTheDocument();
      expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    });

    it('renders the next task once no longer paused', async () => {
      const user = userEvent.setup();
      const els = elements();
      const { rerender } = render(<Run elements={els} timeline={timeline} />);
      rerender(<Run elements={els} timeline={timeline} paused />);
      await user.click(screen.getByText('Complete'));
      rerender(<Run elements={els} timeline={timeline} />);
      expect(screen.getByRole('heading')).toHaveTextContent('Type B');
    });

    it('resumes the task it kept if unpaused before it is completed', () => {
      const els = elements();
      const { rerender } = render(<Run elements={els} timeline={timeline} />);
      rerender(<Run elements={els} timeline={timeline} paused />);
      rerender(<Run elements={els} timeline={timeline} />);
      expect(screen.getByRole('heading')).toHaveTextContent('Type A');
    });

    it('renders elements.paused right away if the pause starts while loading', () => {
      const els = elements();
      render(<Run elements={els} timeline={timeline} loading paused />);
      expect(screen.getByTestId('paused')).toBeInTheDocument();
    });

    it('does not keep a task that starts after the pause did', async () => {
      vi.useFakeTimers();
      const els = elements();
      render(
        <Run
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
        <Run
          elements={els}
          timeline={singleTaskTimeline}
          onCompleted={onCompleted}
        />,
      );
      rerender(
        <Run
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
        <Run elements={els} timeline={singleTaskTimeline} />,
      );
      rerender(<Run elements={els} timeline={singleTaskTimeline} paused />);
      await user.click(screen.getByText('Complete'));
      expect(screen.getByTestId('paused')).toBeInTheDocument();
      rerender(<Run elements={els} timeline={singleTaskTimeline} />);
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
        const element = (paused: boolean) => (
          <ErrorBoundary>
            <Run
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
        spy.mockRestore();
      },
    );

    it('throws a LogDeliveryError if elements.paused is missing', () => {
      const spy = vi.spyOn(console, 'error');
      spy.mockImplementation(() => {});
      const { paused: _paused, ...withoutPaused } = elements();
      let error: unknown;
      try {
        render(<Run elements={withoutPaused} timeline={timeline} paused />);
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(LogDeliveryError);
      spy.mockRestore();
    });

    it('asks for confirmation before unload while paused, even once completed', async () => {
      const user = userEvent.setup();
      const els = elements();
      const { rerender } = render(
        <Run elements={els} timeline={singleTaskTimeline} />,
      );
      rerender(<Run elements={els} timeline={singleTaskTimeline} paused />);
      await user.click(screen.getByText('Complete'));
      const event = new Event('beforeunload', { cancelable: true });
      globalThis.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    });
  });
});
