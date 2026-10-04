import { render, screen } from '@testing-library/react';
import userEventPackage from '@testing-library/user-event';
import { Run, useLogger } from '../src/main.js';

// @ts-expect-error - userEventPackage is not typed correctly
const userEvent: typeof userEventPackage.default = userEventPackage;

describe('useLogger', () => {
  it('can be used with a provided type', async () => {
    const user = userEvent.setup();
    const Task = () => {
      let handleTaskLog = useLogger<'task'>('task');
      return (
        <button
          onClick={() => {
            handleTaskLog({ value: 'value' });
          }}
        >
          log
        </button>
      );
    };
    let config = {
      tasks: { t: <Task /> },
      completed: <div data-testid="end" />,
    };
    const onLog = vi.fn(() => Promise.resolve());
    render(<Run elements={config} timeline={[{ type: 't' }]} onLog={onLog} />);
    await user.click(screen.getByRole('button'));
    expect(onLog).toHaveBeenCalledWith({ type: 'task', value: 'value' });
  });

  it('can be used without providing a type', async () => {
    const user = userEvent.setup();
    const Task = () => {
      let handleLog = useLogger();
      return (
        <button
          onClick={() => {
            handleLog({ type: 'task', value: 'value' });
          }}
        >
          log
        </button>
      );
    };
    let config = {
      tasks: { t: <Task /> },
      completed: <div data-testid="end" />,
    };
    const onLog = vi.fn(() => Promise.resolve());
    render(<Run elements={config} timeline={[{ type: 't' }]} onLog={onLog} />);
    await user.click(screen.getByRole('button'));
    expect(onLog).toHaveBeenCalledWith({ type: 'task', value: 'value' });
  });

  it('throws if Run has no onLog', () => {
    const spy = vi.spyOn(console, 'error');
    spy.mockImplementation(() => {});
    const Task = () => {
      useLogger();
      return null;
    };
    expect(() =>
      render(
        <Run
          elements={{ tasks: { t: <Task /> } }}
          timeline={[{ type: 't' }]}
        />,
      ),
    ).toThrow('No logger found. Was onLog provided in <Run />?');
    spy.mockRestore();
  });

  describe('when onLog changes', () => {
    const LogTask = () => {
      const log = useLogger();
      return (
        <button onClick={() => log({ type: 'task', value: 'value' })}>
          log
        </button>
      );
    };
    const elements = { tasks: { t: <LogTask /> } };
    const timeline = [{ type: 't' }];

    it('logs to an onLog provided after loading', async () => {
      const user = userEvent.setup();
      const { rerender } = render(<Run elements={elements} loading />);
      const onLog = vi.fn(() => Promise.resolve());
      rerender(<Run elements={elements} timeline={timeline} onLog={onLog} />);
      await user.click(await screen.findByRole('button'));
      expect(onLog).toHaveBeenCalledWith({ type: 'task', value: 'value' });
    });

    it('logs to the latest onLog', async () => {
      const user = userEvent.setup();
      const onLogA = vi.fn(() => Promise.resolve());
      const onLogB = vi.fn(() => Promise.resolve());
      const { rerender } = render(
        <Run elements={elements} timeline={timeline} onLog={onLogA} />,
      );
      rerender(<Run elements={elements} timeline={timeline} onLog={onLogB} />);
      await user.click(screen.getByRole('button'));
      expect(onLogA).not.toHaveBeenCalled();
      expect(onLogB).toHaveBeenCalledWith({ type: 'task', value: 'value' });
    });

    it('returns the same logger when onLog changes', () => {
      const loggers = new Set<unknown>();
      const Task = () => {
        loggers.add(useLogger());
        return null;
      };
      const taskElements = { tasks: { t: <Task /> } };
      const { rerender } = render(
        <Run
          elements={taskElements}
          timeline={timeline}
          onLog={async () => {}}
        />,
      );
      rerender(
        <Run
          elements={taskElements}
          timeline={timeline}
          onLog={async () => {}}
        />,
      );
      expect(loggers.size).toBe(1);
    });
  });
});
