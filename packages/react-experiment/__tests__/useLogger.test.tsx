import { render, screen } from '@testing-library/react';
import { Run, useLogger } from '../src/main.js';
import userEventPackage from '@testing-library/user-event';

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
});
