import type { MaybeAsyncIterator, SuperIterator } from './types.js';

/**
 * Skips every task up to and including the first one matching `predicate`.
 * Use it to resume a timeline after the last task a run completed.
 *
 * The result stays synchronous for as long as the timeline is, so resuming a
 * synchronous timeline never needs to wait.
 *
 * The timeline is replayed from its start until a task matches, so `predicate`
 * must be pure, and a generator runs its code again up to that point.
 *
 * @param timeline Timeline to resume.
 * @param predicate Returns `true` for the last task that was completed.
 * @returns A timeline starting right after the first matching task. Its first
 * `next()` call throws, or rejects for an async timeline, if no task matches.
 */
export function resumeAfter<Task>(
  timeline: SuperIterator<Task>,
  predicate: (task: Task) => boolean,
): MaybeAsyncIterator<Task> {
  const iterator: MaybeAsyncIterator<Task> =
    Symbol.iterator in timeline
      ? timeline[Symbol.iterator]()
      : Symbol.asyncIterator in timeline
        ? timeline[Symbol.asyncIterator]()
        : timeline;
  let skipped = false;
  // Skipping in a loop rather than completing each task from a runner's
  // onTaskStarted avoids a recursion that overflows the stack on long
  // timelines.
  const skip = (
    result: IteratorResult<Task>,
  ): IteratorResult<Task> | Promise<IteratorResult<Task>> => {
    while (!result.done) {
      if (predicate(result.value)) {
        skipped = true;
        return iterator.next();
      }
      const next = iterator.next();
      if ('then' in next) return next.then(skip);
      result = next;
    }
    throw new Error('No task matched the resumeAfter predicate');
  };
  return {
    next() {
      if (skipped) return iterator.next();
      const first = iterator.next();
      return 'then' in first ? first.then(skip) : skip(first);
    },
  };
}
