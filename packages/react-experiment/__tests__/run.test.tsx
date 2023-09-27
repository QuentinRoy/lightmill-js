import { act, fireEvent, render, screen } from '@testing-library/react';
import userEventPackage from '@testing-library/user-event';
import { Run, RunElements, useTask } from '../src/main.js';
import * as React from 'react';

const userEvent =
  userEventPackage as unknown as typeof userEventPackage.default;

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type Task = { type: 'A'; a: string } | { type: 'B'; b: number };

describe('run', () => {
  let Task: (props: { type: string; dataProp: string }) => JSX.Element;
  let tasks: Task[];
  let asyncTaskGen: (
    taskLoadingTime: number,
  ) => AsyncGenerator<Task, void, unknown>;

  beforeEach(() => {
    Task = ({ type, dataProp }) => {
      let { task, onTaskCompleted } = useTask();
      return (
        <div>
          <h1>Type {type}</h1>
          <p data-testid="data">{task[dataProp]}</p>
          <button onClick={onTaskCompleted}>Complete</button>
        </div>
      );
    };
    tasks = [
      { type: 'A', a: 'hello' },
      { type: 'B', b: 42 },
      { type: 'A', a: 'world' },
    ];
    asyncTaskGen = async function* (taskLoadingTime) {
      for (let task of tasks) {
        await wait(taskLoadingTime);
        yield task;
      }
      await wait(taskLoadingTime);
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
    render(<Run elements={config} timeline={tasks} />);
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

  it('renders nothing when the experiment is done if no completed element is provided', async () => {
    const user = userEvent.setup();
    let config: RunElements<Task> = {
      tasks: {
        A: <Task type="A" dataProp="a" />,
        B: <Task type="B" dataProp="b" />,
      },
    };
    let { container } = render(<Run elements={config} timeline={tasks} />);

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
    render(<Run elements={config} timeline={asyncTaskGen(taskTime)} />);
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

    let config: RunElements<Task> = {
      tasks: {
        A: <Task type="A" dataProp="a" />,
        B: <Task type="B" dataProp="b" />,
      },
      loading: <div data-testid="loading" />,
      completed: <div data-testid="end" />,
    };

    function Test() {
      const [isLoading, toggleLoading] = React.useReducer((s) => !s, true);
      const [timeline, loadTimeline] = React.useReducer(
        (): Task[] | undefined => tasks,
        undefined,
      );
      return (
        <div>
          {/* @ts-expect-error this is a test */}
          <Run elements={config} loading={isLoading} timeline={timeline} />
          <button data-testid="load-timeline-button" onClick={loadTimeline}>
            Load Timeline
          </button>
          <button data-testid="toggle-loading-button" onClick={toggleLoading}>
            {isLoading ? 'Finish Loading' : 'Load'}
          </button>
        </div>
      );
    }

    render(<Test />);
    expect(screen.getByTestId('loading')).toBeInTheDocument();
    await user.click(screen.getByTestId('load-timeline-button'));
    expect(screen.getByTestId('loading')).toBeInTheDocument();
    await user.click(screen.getByTestId('toggle-loading-button'));
    expect(screen.getByRole('heading')).toHaveTextContent('Type A');
    expect(screen.getByTestId('data')).toHaveTextContent('hello');
    await user.click(screen.getByText('Complete'));
    expect(screen.getByRole('heading')).toHaveTextContent('Type B');
    expect(screen.getByTestId('data')).toHaveTextContent('42');
    await user.click(screen.getByTestId('toggle-loading-button'));
    expect(screen.getByTestId('loading')).toBeInTheDocument();
    await user.click(screen.getByTestId('toggle-loading-button'));
    expect(screen.getByRole('heading')).toHaveTextContent('Type B');
    expect(screen.getByTestId('data')).toHaveTextContent('42');
    await user.click(screen.getByText('Complete'));
    expect(screen.getByRole('heading')).toHaveTextContent('Type A');
    expect(screen.getByTestId('data')).toHaveTextContent('world');
    await user.click(screen.getByText('Complete'));
    expect(screen.getByTestId('end')).toBeInTheDocument();
  });
});
