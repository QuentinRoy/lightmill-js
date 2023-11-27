import { act, fireEvent, render, screen } from '@testing-library/react';
import userEventPackage from '@testing-library/user-event';
import { Run, RunElements, useTask } from '../src/main.js';

// @ts-expect-error - userEventPackage is not typed correctly
const userEvent: typeof userEventPackage.default = userEventPackage;

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type Task = { type: 'A'; a: string } | { type: 'B'; b: number };

describe('run', () => {
  let Task: (props: { type: string; dataProp: string }) => JSX.Element;
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
    Task = ({ type, dataProp }) => {
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

    // I cannot find a way to test rendering errors without React displaying
    // them in the console.
    console.log(
      "Don't worry about the error below, it's unfortunate but expected",
    );
    expect(() => {
      rerender(
        <Run elements={elements} timeline={[{ type: 'A', a: 'world' }]} />,
      );
    }).toThrow('Timeline cannot be changed once set');
  });

  it('throws an error if the run should resume after an non existing task', async () => {
    // I cannot find a way to test rendering errors without React displaying
    // them in the console.
    console.log(
      "Don't worry about the error below, it's unfortunate but expected",
    );
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
  });
});
