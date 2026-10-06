import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
    let logCall = vi.fn<(...args: LogCallArgs) => LogCallResult>();
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

  it('reports an error thrown by a sync timeline through onError', () => {
    const error = new Error('timeline failed');
    const onError = vi.fn();
    const runner = new TimelineRunner<Task>({
      timeline: {
        next() {
          throw error;
        },
      },
      onError,
    });
    runner.start();
    expect(onError.mock.calls).toEqual([[error]]);
    expect(runner.status).toBe('crashed');
  });

  it('throws an error thrown by a sync timeline if there is no onError', () => {
    const runner = new TimelineRunner<Task>({
      timeline: {
        next() {
          throw new Error('timeline failed');
        },
      },
    });
    expect(() => runner.start()).toThrow('timeline failed');
    expect(runner.status).toBe('crashed');
  });

  it('runs an iterator that turns async partway through', async () => {
    let i = 0;
    const onTaskStarted = vi.fn((task: Task) => {
      logCall('onTaskStarted', task);
      runner.completeTask();
    });
    const onTimelineCompleted = vi.fn(() => logCall('onTimelineCompleted'));
    const logCall = vi.fn();
    const runner = new TimelineRunner<Task>({
      timeline: {
        next() {
          const result: IteratorResult<Task> =
            i < timeline.length
              ? { done: false, value: timeline[i] }
              : { done: true, value: undefined };
          return i++ === 0 ? result : Promise.resolve(result);
        },
      },
      onTaskStarted,
      onTimelineCompleted,
    });
    runner.start();
    expect(logCall.mock.calls).toEqual([
      ['onTaskStarted', { type: 'typeA', dA: 1 }],
    ]);
    await wait();
    expect(logCall.mock.calls).toEqual([
      ['onTaskStarted', { type: 'typeA', dA: 1 }],
      ['onTaskStarted', { type: 'typeB', dB: 2 }],
      ['onTaskStarted', { type: 'typeA', dA: 3 }],
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
    let onTaskStarted = vi.fn<(...args: unknown[]) => void>(() => {
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

  it('completes many sync tasks from onTaskStarted without overflowing the stack', () => {
    let onTaskCompleted = vi.fn();
    let onTimelineCompleted = vi.fn();
    let runner = new TimelineRunner<number>({
      timeline: Array.from({ length: 10_000 }, (_, i) => i),
      onTaskStarted() {
        runner.completeTask();
      },
      onTaskCompleted,
      onTimelineCompleted,
    });
    runner.start();
    expect(onTaskCompleted).toHaveBeenCalledTimes(10_000);
    expect(onTimelineCompleted).toHaveBeenCalledTimes(1);
    expect(runner.status).toBe('completed');
  });

  it('starts the next task after onTaskStarted returns when it completes its task', () => {
    let calls: string[] = [];
    let runner = new TimelineRunner<number>({
      timeline: [1, 2],
      onTaskStarted(task) {
        calls.push(`start ${task}`);
        runner.completeTask();
        calls.push(`after complete ${task}`);
      },
      onTaskCompleted(task) {
        calls.push(`completed ${task}`);
      },
    });
    runner.start();
    expect(calls).toEqual([
      'start 1',
      'completed 1',
      'after complete 1',
      'start 2',
      'completed 2',
      'after complete 2',
    ]);
  });

  it('crashes when onTaskStarted throws', () => {
    let error = new Error('oops');
    let onTaskCompleted = vi.fn();
    let runner = new TimelineRunner<number>({
      timeline: [1, 2],
      onTaskStarted() {
        runner.completeTask();
        throw error;
      },
      onTaskCompleted,
    });
    expect(() => runner.start()).toThrow(error);
    expect(runner.status).toBe('crashed');
    expect(() => runner.completeTask()).toThrow('No task is currently running');
    expect(onTaskCompleted.mock.calls).toEqual([[1]]);
  });

  it('throws when onTaskStarted completes its task twice', () => {
    let onTaskCompleted = vi.fn();
    let runner = new TimelineRunner<number>({
      timeline: [1, 2],
      onTaskStarted() {
        runner.completeTask();
        runner.completeTask();
      },
      onTaskCompleted,
    });
    expect(() => runner.start()).toThrow('Task already completed');
    expect(onTaskCompleted.mock.calls).toEqual([[1]]);
  });

  it('ignores a pending async next() once canceled', async () => {
    let pending = deffer<IteratorResult<number>>({ value: 1, done: false });
    let onTaskStarted = vi.fn();
    let onError = vi.fn();
    let runner = new TimelineRunner<number>({
      timeline: { next: () => pending.promise },
      onTaskStarted,
      onError,
    });
    runner.start();
    runner.cancel();
    pending.resolve();
    await wait();
    expect(runner.status).toBe('canceled');
    expect(onTaskStarted).not.toHaveBeenCalled();
  });

  it('ignores a pending async next() rejection once canceled', async () => {
    let pending = deffer<IteratorResult<number>>({ value: 1, done: false });
    let onError = vi.fn();
    let runner = new TimelineRunner<number>({
      timeline: { next: () => pending.promise },
      onError,
    });
    runner.start();
    runner.cancel();
    pending.reject(new Error('oops'));
    await wait();
    expect(runner.status).toBe('canceled');
    expect(onError).not.toHaveBeenCalled();
  });

  it('calls onTimelineCanceled once, after the status changes, on cancel', () => {
    let statuses: string[] = [];
    let runner = new TimelineRunner<number>({
      timeline: [1, 2],
      onTimelineCanceled() {
        statuses.push(runner.status);
      },
    });
    runner.start();
    runner.cancel();
    expect(statuses).toEqual(['canceled']);
    expect(() => runner.cancel()).toThrow('already canceled');
    expect(statuses).toEqual(['canceled']);
  });

  it('calls onTimelineCanceled when canceled during a pending async next()', async () => {
    let pending = deffer<IteratorResult<number>>({ value: 1, done: false });
    let onTimelineCanceled = vi.fn();
    let runner = new TimelineRunner<number>({
      timeline: { next: () => pending.promise },
      onTimelineCanceled,
    });
    runner.start();
    runner.cancel();
    pending.resolve();
    await wait();
    expect(onTimelineCanceled).toHaveBeenCalledTimes(1);
  });

  it('propagates an error thrown by onTimelineCanceled, leaving the runner canceled', () => {
    let error = new Error('oops');
    let runner = new TimelineRunner<number>({
      timeline: [1],
      onTimelineCanceled() {
        throw error;
      },
    });
    runner.start();
    expect(() => runner.cancel()).toThrow(error);
    expect(runner.status).toBe('canceled');
  });

  it('does not call onTimelineCanceled when cancel throws', () => {
    let onTimelineCanceled = vi.fn();
    let runner = new TimelineRunner<number>({
      timeline: [],
      onTimelineCanceled,
    });
    runner.start();
    expect(() => runner.cancel()).toThrow('already completed');
    expect(onTimelineCanceled).not.toHaveBeenCalled();
  });
});
