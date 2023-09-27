import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { TimelineRunner } from '../src/runner.js';

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
  let resolve: (() => void) | null = null;
  let reject: ((err?: Error) => void) | null = null;
  const promise = new Promise<V | undefined>((res, rej) => {
    resolve = () => res(value);
    reject = rej;
  });
  if (resolve == null || reject == null) {
    throw new Error('Internal error: No resolve or reject function');
  }
  return { promise, resolve, reject };
}

describe('TimelineRunner', () => {
  let timeline: Task[];

  beforeEach(() => {
    timeline = [
      { type: 'typeA', dA: 1 },
      { type: 'typeB', dB: 2 },
      { type: 'typeA', dA: 3 },
    ];
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('run tasks and corresponding handlers', async () => {
    let logCall = vi.fn<LogCallArgs, LogCallResult>();
    type LogCallArgs = [handlerName: string, ...rest: unknown[]];
    type LogCallResult = Promise<void>;
    let runner = new TimelineRunner<Task>({
      timeline,
      onTaskCompleted(...args) {
        logCall('onTaskCompleted', ...args);
      },
      onTaskStarted(...args) {
        logCall('onTaskStarted', ...args);
      },
      onTimelineCompleted(...args) {
        logCall('onTimelineCompleted', ...args);
      },
      onTimelineStarted(...args) {
        logCall('onTimelineStarted', ...args);
      },
      onTimelineCanceled(...args) {
        logCall('onTimelineCanceled', ...args);
      },
      onLoading(...args) {
        logCall('onLoading', ...args);
      },
      onError(...args) {
        logCall('onError', ...args);
      },
    });

    runner.start();
    expect(logCall.mock.calls).toEqual([
      ['onTimelineStarted'],
      ['onTaskStarted', { type: 'typeA', dA: 1 }],
    ]);
    logCall.mockClear();
    runner.completeTask();
    expect(logCall.mock.calls).toEqual([
      ['onTaskCompleted', { type: 'typeA', dA: 1 }],
      ['onTaskStarted', { type: 'typeB', dB: 2 }],
    ]);
    logCall.mockClear();
    runner.completeTask();
    expect(logCall.mock.calls).toEqual([
      ['onTaskCompleted', { type: 'typeB', dB: 2 }],
      ['onTaskStarted', { type: 'typeA', dA: 3 }],
    ]);
    logCall.mockClear();
    runner.completeTask();
    expect(logCall.mock.calls).toEqual([
      ['onTaskCompleted', { type: 'typeA', dA: 3 }],
      ['onTimelineCompleted'],
    ]);
  });

  it('maintains its status property', async () => {
    let taskDeffers = timeline.map((task) => deffer(task));
    async function* taskGen() {
      for (const deffer of taskDeffers) {
        yield deffer.promise;
      }
    }
    let onTaskStarted = vi.fn<unknown[], void>(() => {
      expect(runner.status).toBe('running');
    });
    let onTimelineStarted = vi.fn(() => {
      expect(runner.status).toBe('running');
    });
    let onTimelineCompleted = vi.fn(() => {
      expect(runner.status).toBe('completed');
    });
    let onLoading = vi.fn(() => {
      expect(runner.status).toBe('loading');
    });
    let runner = new TimelineRunner<Task>({
      timeline: taskGen(),
      onTaskStarted,
      onTimelineStarted,
      onTimelineCompleted,
      onLoading,
    });
    expect(runner.status).toBe('idle');
    runner.start();
    expect(runner.status).toBe('loading');
    expect(onTimelineStarted.mock.calls).toEqual([[]]);
    expect(onLoading.mock.calls).toEqual([[]]);
    taskDeffers[0].resolve();
    await wait();
    expect(onTaskStarted.mock.calls).toEqual([[{ type: 'typeA', dA: 1 }]]);
    runner.completeTask();
    await wait();
    expect(runner.status).toBe('loading');
    expect(onLoading.mock.calls).toEqual([[], []]);
    taskDeffers[1].resolve();
    await wait();
    expect(onTaskStarted.mock.calls).toEqual([
      [{ type: 'typeA', dA: 1 }],
      [{ type: 'typeB', dB: 2 }],
    ]);
    await wait();
    runner.completeTask();
    expect(runner.status).toBe('loading');
    expect(onLoading.mock.calls).toEqual([[], [], []]);
    taskDeffers[2].resolve();
    await wait();
    expect(onTaskStarted.mock.calls).toEqual([
      [{ type: 'typeA', dA: 1 }],
      [{ type: 'typeB', dB: 2 }],
      [{ type: 'typeA', dA: 3 }],
    ]);
    runner.completeTask();
    expect(runner.status).toBe('loading');
    expect(onLoading.mock.calls).toEqual([[], [], [], []]);
    await wait();
    expect(onTimelineCompleted.mock.calls).toEqual([[]]);
  });
});
