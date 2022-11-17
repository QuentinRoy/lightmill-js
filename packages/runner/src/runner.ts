import { asyncForEach } from './utils.js';

type RunnerProps<Task, TaskResult> = {
  taskIterator: Iterator<Task> | AsyncIterator<Task>;
  runTask: (task: Task) => Promise<TaskResult>;
};

export default function run<Task, TaskResult>({
  taskIterator,
  runTask,
}: RunnerProps<Task, TaskResult>) {
  return asyncForEach(taskIterator, async (task) => {
    await runTask(task);
  });
}
