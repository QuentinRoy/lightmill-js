import { TimelineRunner } from './runner.js';
import { SuperIterator } from './types.js';

export type RunTimelineParams<Task> = {
  timeline: SuperIterator<Task>;
  runTask: (task: Task) => PromiseLike<void>;
};
export function runTimeline<Task>({
  timeline,
  runTask,
}: RunTimelineParams<Task>) {
  return new Promise<void>((resolve, reject) => {
    let runner = new TimelineRunner<Task>({
      timeline,
      onTaskStarted(task) {
        runTask(task).then(() => {
          runner.completeTask();
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
