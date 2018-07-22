import { reduceAsyncIterator } from './utils';

export default ({ store, taskIterator, taskManager }) => ({
  start: () =>
    reduceAsyncIterator(taskIterator, async (_, task) => {
      // Run the task.
      const measures = await taskManager(task);
      // Log the results.
      await store.log(task.id, { task, measures });
    }).then(async () => {
      // At the very end (when all tasks has been done), we mark the experiment
      // as complete. Do not directly return store.complete because we don't
      // want to return the result of the call.
      await store.complete();
    })
});
