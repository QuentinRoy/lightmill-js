import { TimelineRunner } from './runner.js';
import type { SuperIterator } from './types.js';

export type RunTimelineParams<Task, TaskResult = unknown> = {
  timeline: SuperIterator<Task, TaskResult>;
  // What the promise resolves with goes to the timeline's next().
  runTask: (task: Task) => PromiseLike<TaskResult>;
};
export function runTimeline<Task, TaskResult = unknown>({
  timeline,
  runTask,
}: RunTimelineParams<Task, TaskResult>) {
  return new Promise<void>((resolve, reject) => {
    let runner = new TimelineRunner<Task, TaskResult>({
      timeline,
      onTaskStarted(task) {
        runTask(task).then((result) => {
          runner.completeTask(result);
        }, reject);
      },
      onTimelineCompleted() {
        resolve();
      },
      onError(error) {
        reject(error);
      },
    }).start();
  });
}
