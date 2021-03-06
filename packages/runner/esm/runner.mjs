import { asyncForEach } from './utils.mjs';

const Runner = ({ store, taskIterator, runTask }) => ({
  run: () => {
    const taskLogger = store.getLogger('task');
    const runThenLog = task =>
      runTask(task)
        .then(measures => taskLogger.log({ task, measures }, { id: task.id }))
        .then(() => {});
    return asyncForEach(taskIterator, runThenLog)
      .then(() => store.complete())
      .then(() => {});
  }
});

export default Runner;
