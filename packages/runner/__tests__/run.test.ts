import { beforeEach, describe, expect, it, Mock, vi } from 'vitest';
import { runTimeline } from '../src/run.js';

const wait = (t: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, t);
  });

const Indexer = () => {
  let i = -1;
  return () => {
    i++;
    return i;
  };
};

describe('run', () => {
  let genTasks: Mock<[], AsyncGenerator<{ id: string }>>;
  let runTask: Mock<[{ id: string }], Promise<void>>;

  beforeEach(() => {
    const getCallIndex = Indexer();
    genTasks = vi.fn(async function* mockGenTasks() {
      await wait(0);
      yield { id: 'task1', callIndex: getCallIndex() };
      await wait(0);
      yield { id: 'task2', callIndex: getCallIndex() };
      await wait(0);
      yield { id: 'task3', callIndex: getCallIndex() };
      await wait(0);
    });
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    runTask = vi.fn(async (task) => {
      await wait(0);
      getCallIndex();
    });
  });

  it('calls runTask for each tasks', async () => {
    await expect(runTimeline({ timeline: genTasks(), runTask })).resolves.toBe(
      undefined,
    );
    expect(runTask.mock.calls).toEqual([
      [{ id: 'task1', callIndex: 0 }],
      [{ id: 'task2', callIndex: 2 }],
      [{ id: 'task3', callIndex: 4 }],
    ]);
  });

  it('rejects if the taskManager rejects', async () => {
    const throwingRunTask = vi.fn(async (task) => {
      if (task.id === 'task2') throw new Error('mock error');
    });
    await expect(
      runTimeline({ runTask: throwingRunTask, timeline: genTasks() }),
    ).rejects.toThrow('mock error');
    expect(throwingRunTask.mock.calls).toEqual([
      [{ id: 'task1', callIndex: 0 }],
      [{ id: 'task2', callIndex: 1 }],
    ]);
  });

  it('rejects if the timeline rejects', async () => {
    const throwingGenTasks = vi.fn(async function* mockGenTasks() {
      await wait(0);
      yield { id: 'task1' };
      await wait(0);
      yield { id: 'task2' };
      throw new Error('mock error');
    });
    await expect(
      runTimeline({ runTask, timeline: throwingGenTasks() }),
    ).rejects.toThrow('mock error');
    expect(runTask.mock.calls).toEqual([[{ id: 'task1' }], [{ id: 'task2' }]]);
  });
});
