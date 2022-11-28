import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Runner } from '../src/runner.js';

function wait(t = 0) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, t);
  });
}

type Task = { type: 'typeA'; dA: number } | { type: 'typeB'; dB: number };

type Deffered<V> = {
  promise: Promise<V>;
  resolve: () => void;
  reject: (err?: Error) => void;
};
function deffer<V>(value: V): Deffered<V>;
function deffer(): Deffered<void>;
function deffer<V>(value?: V) {
  let resolve: () => void;
  let reject: (err?: Error) => void;
  const promise = new Promise<V>((res, rej) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolve = () => res(value as any);
    reject = rej;
  });
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return { promise, resolve: resolve!, reject: reject! };
}

describe('Runner', () => {
  let tasks: Task[];
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let handler = vi.fn((handlerName: string, ...rest: unknown[]) => wait());

  beforeEach(() => {
    tasks = [
      { type: 'typeA' as const, dA: 1 },
      { type: 'typeB' as const, dB: 2 },
      { type: 'typeA' as const, dA: 3 },
    ];
    handler.mockReset();
  });

  it('run tasks and calls their corresponding handlers', async () => {
    let runner = new Runner<Task>({
      tasks: {
        typeA: (...args) => handler('typeA', ...args),
        typeB: (...args) => handler('typeB', ...args),
      },
    });
    await expect(runner.run(tasks)).resolves.toBe(undefined);
    expect(handler.mock.calls).toEqual([
      ['typeA', { type: 'typeA', dA: 1 }],
      ['typeB', { type: 'typeB', dB: 2 }],
      ['typeA', { type: 'typeA', dA: 3 }],
    ]);
  });

  it('supports progress handlers', async () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    let handler = vi.fn((...args: unknown[]) => wait());
    let runner = new Runner<Task>({
      tasks: {
        typeA: (...args) => handler('typeA', ...args),
        typeB: (...args) => handler('typeB', ...args),
      },
      onExperimentStarted: (...args) => handler('onExperimentStarted', ...args),
      onExperimentCompleted: (...args) =>
        handler('onExperimentCompleted', ...args),
      onLoading: (...args) => handler('onLoading', ...args),
    });
    await expect(runner.run(tasks)).resolves.toBe(undefined);
    expect(handler.mock.calls).toEqual([
      ['onExperimentStarted'],
      ['onLoading'],
      ['typeA', { type: 'typeA', dA: 1 }],
      ['onLoading'],
      ['typeB', { type: 'typeB', dB: 2 }],
      ['onLoading'],
      ['typeA', { type: 'typeA', dA: 3 }],
      ['onLoading'],
      ['onExperimentCompleted'],
    ]);
  });

  it('maintains its state property', async () => {
    type HanlerArgs = [string, ...unknown[]];
    let taskDeffers = tasks.map((task) => deffer(task));
    async function* taskGen() {
      for (const deffer of taskDeffers) {
        yield deffer.promise;
      }
    }
    let taskHandler = vi.fn<HanlerArgs, Deffered<void>>(() => {
      expect(runner.state).toBe('running');
      return deffer();
    });
    let onExperimentStarted = vi.fn(() => {
      expect(runner.state).toBe('loading');
    });
    let onExperimentCompleted = vi.fn(() => {
      expect(runner.state).toBe('completed');
    });
    let onLoading = vi.fn(() => {
      expect(runner.state).toBe('loading');
    });
    let runner = new Runner<Task>({
      tasks: {
        typeA: (...args) => taskHandler('typeA', ...args).promise,
        typeB: (...args) => taskHandler('typeB', ...args).promise,
      },
      onExperimentStarted: onExperimentStarted,
      onExperimentCompleted: onExperimentCompleted,
      onLoading: onLoading,
    });
    expect(runner.state).toBe('idle');
    let runPromise = runner.run(taskGen());
    expect(runner.state).toBe('loading');
    expect(onExperimentStarted.mock.calls).toEqual([[]]);
    expect(onLoading.mock.calls).toEqual([[]]);
    taskDeffers[0].resolve();
    await wait();
    expect(taskHandler.mock.calls).toEqual([
      ['typeA', { type: 'typeA', dA: 1 }],
    ]);
    taskHandler.mock.results[0].value.resolve();
    await wait();
    expect(runner.state).toBe('loading');
    expect(onLoading.mock.calls).toEqual([[], []]);
    taskDeffers[1].resolve();
    await wait();
    expect(taskHandler.mock.calls).toEqual([
      ['typeA', { type: 'typeA', dA: 1 }],
      ['typeB', { type: 'typeB', dB: 2 }],
    ]);
    await wait();
    taskHandler.mock.results[1].value.resolve();
    await wait();
    expect(runner.state).toBe('loading');
    expect(onLoading.mock.calls).toEqual([[], [], []]);
    taskDeffers[2].resolve();
    await wait();
    expect(taskHandler.mock.calls).toEqual([
      ['typeA', { type: 'typeA', dA: 1 }],
      ['typeB', { type: 'typeB', dB: 2 }],
      ['typeA', { type: 'typeA', dA: 3 }],
    ]);
    taskHandler.mock.results[2].value.resolve();
    await runPromise;
    expect(onExperimentCompleted.mock.calls).toEqual([[]]);
  });
});
