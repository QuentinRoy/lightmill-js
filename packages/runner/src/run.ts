import { asyncForEach } from './utils.js';

export type SuperIterator<I> =
  | Iterator<I>
  | AsyncIterator<I>
  | Iterable<I>
  | AsyncIterable<I>;

export type RunProps<Task> = {
  taskIterator: SuperIterator<Task>;
  runTask: (task: Task) => PromiseLike<void>;
};
export function run<Task>({ taskIterator, runTask }: RunProps<Task>) {
  if (Symbol.iterator in taskIterator) {
    taskIterator = taskIterator[Symbol.iterator]();
  }
  if (Symbol.asyncIterator in taskIterator) {
    taskIterator = taskIterator[Symbol.asyncIterator]();
  }
  return asyncForEach(taskIterator, (task) => runTask(task));
}
