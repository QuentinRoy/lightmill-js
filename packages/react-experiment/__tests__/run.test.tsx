import { act, render, screen } from '@testing-library/react';
import userEventPackage from '@testing-library/user-event';
import { RunConfig } from '../src/config.js';
import { Run, useTask } from '../src/run.js';

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
    taskLoadingTime: number
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
    let config: RunConfig<Task> = {
      tasks: {
        A: <Task type="A" dataProp="a" />,
        B: <Task type="B" dataProp="b" />,
      },
      completed: <div data-testid="end" />,
    };
    render(<Run config={config} timeline={tasks} />);
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
    let config: RunConfig<Task> = {
      tasks: {
        A: <Task type="A" dataProp="a" />,
        B: <Task type="B" dataProp="b" />,
      },
    };
    let { container } = render(<Run config={config} timeline={tasks} />);

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
    const user = userEvent.setup({
      advanceTimers: () => {
        vi.advanceTimersToNextTimer();
      },
    });
    let config: RunConfig<Task> = {
      tasks: {
        A: <Task type="A" dataProp="a" />,
        B: <Task type="B" dataProp="b" />,
      },
      loading: <div data-testid="loading" />,
      completed: <div data-testid="end" />,
    };
    render(<Run config={config} timeline={asyncTaskGen(taskTime)} />);
    expect(screen.getByTestId('loading')).toBeInTheDocument();
    await act(() => {
      vi.advanceTimersByTime(taskTime);
    });
    expect(screen.getByRole('heading')).toHaveTextContent('Type A');
    expect(screen.getByTestId('data')).toHaveTextContent('hello');
    await user.click(screen.getByRole('button'));
    expect(screen.getByTestId('loading')).toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(taskTime);
    });
    expect(screen.getByRole('heading')).toHaveTextContent('Type B');
    expect(screen.getByTestId('data')).toHaveTextContent('42');
    await user.click(screen.getByRole('button'));
    expect(screen.getByTestId('loading')).toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(taskTime);
    });
    expect(screen.getByRole('heading')).toHaveTextContent('Type A');
    expect(screen.getByTestId('data')).toHaveTextContent('world');
    await act(async () => {
      vi.advanceTimersByTime(taskTime);
    });
    await user.click(screen.getByRole('button'));
    expect(screen.getByTestId('loading')).toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(taskTime);
    });
    expect(screen.getByTestId('end')).toBeInTheDocument();
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });
});