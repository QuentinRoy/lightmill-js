import { describe, expect, it } from 'vitest';
import { resumeAfter, TimelineRunner } from '../src/main.js';

type Task = { id: number };

const tasks: Task[] = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];

function collectSync(timeline: { next(): IteratorResult<Task> }): Task[] {
  const result: Task[] = [];
  for (let r = timeline.next(); !r.done; r = timeline.next()) {
    result.push(r.value);
  }
  return result;
}

async function collect(timeline: {
  next(): IteratorResult<Task> | Promise<IteratorResult<Task>>;
}): Promise<Task[]> {
  const result: Task[] = [];
  for (let r = await timeline.next(); !r.done; r = await timeline.next()) {
    result.push(r.value);
  }
  return result;
}

describe('resumeAfter', () => {
  it('starts after the first task matching the predicate', () => {
    const resumed = resumeAfter(tasks, (task) => task.id === 2);
    expect(collectSync(resumed as { next(): IteratorResult<Task> })).toEqual([
      { id: 3 },
      { id: 4 },
    ]);
  });

  it('skips through the first match only', () => {
    const duplicated = [{ id: 1 }, { id: 2 }, { id: 1 }, { id: 3 }];
    const resumed = resumeAfter(duplicated, (task) => task.id === 1);
    expect(collectSync(resumed as { next(): IteratorResult<Task> })).toEqual([
      { id: 2 },
      { id: 1 },
      { id: 3 },
    ]);
  });

  it('yields nothing when the match is the last task', () => {
    const resumed = resumeAfter(tasks, (task) => task.id === 4);
    expect(collectSync(resumed as { next(): IteratorResult<Task> })).toEqual(
      [],
    );
  });

  it('resumes a sync generator', () => {
    function* generate() {
      yield* tasks;
    }
    const resumed = resumeAfter(generate(), (task) => task.id === 1);
    expect(collectSync(resumed as { next(): IteratorResult<Task> })).toEqual([
      { id: 2 },
      { id: 3 },
      { id: 4 },
    ]);
  });

  it('stays sync for a sync timeline', () => {
    const resumed = resumeAfter(tasks, (task) => task.id === 2);
    expect(resumed.next()).not.toBeInstanceOf(Promise);
  });

  it('resumes an async generator', async () => {
    async function* generate() {
      yield* tasks;
    }
    const resumed = resumeAfter(generate(), (task) => task.id === 3);
    expect(await collect(resumed)).toEqual([{ id: 4 }]);
  });

  it('resumes an iterator that turns async partway through', async () => {
    let i = 0;
    const mixed = {
      next(): IteratorResult<Task> | Promise<IteratorResult<Task>> {
        const value = tasks[i++];
        const result: IteratorResult<Task> =
          value == null
            ? { done: true, value: undefined }
            : { done: false, value };
        return i > 2 ? Promise.resolve(result) : result;
      },
    };
    const resumed = resumeAfter(mixed, (task) => task.id === 3);
    expect(await collect(resumed)).toEqual([{ id: 4 }]);
  });

  it('throws on the first next() when no task matches', () => {
    const resumed = resumeAfter(tasks, (task) => task.id === 0);
    expect(() => resumed.next()).toThrow('No task matched');
  });

  it('rejects on the first next() when no task of an async timeline matches', async () => {
    async function* generate() {
      yield* tasks;
    }
    const resumed = resumeAfter(generate(), (task) => task.id === 0);
    await expect(resumed.next()).rejects.toThrow('No task matched');
  });

  it('can be given to a runner', () => {
    const started: Task[] = [];
    const runner = new TimelineRunner<Task>({
      timeline: resumeAfter(tasks, (task) => task.id === 3),
      onTaskStarted(task) {
        started.push(task);
        runner.completeTask();
      },
    });
    runner.start();
    expect(started).toEqual([{ id: 4 }]);
  });
});
