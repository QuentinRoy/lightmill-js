import { asyncForEach } from './utils.mjs';

export default ({ store, taskIterator, runTask }) => ({
  run: () => {
    const taskLogger = store.getLogger('task');
    const runThenLog = task =>
      runTask(task)
        .then(measures => taskLogger.log(task.id, { task, measures }))
        .then(() => {});
    return asyncForEach(taskIterator, runThenLog)
      .then(() => store.complete())
      .then(() => {});
  }
});
