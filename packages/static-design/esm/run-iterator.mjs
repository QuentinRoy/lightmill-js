export default (
  { id: runId, tasks },
  { resumeAfter = undefined, resumeWith = undefined } = {}
) => {
  let startIndex = 0;

  if (resumeAfter != null) {
    const lastTaskIndex = tasks.findIndex((s) => s.id === resumeAfter);
    if (lastTaskIndex < 0) {
      throw new Error(
        `Cannot resume after task "${resumeAfter}": the task could not be found`
      );
    }
    startIndex = lastTaskIndex + 1;
  }

  const tasksIterator = tasks.slice(startIndex)[Symbol.iterator]();

  // Used to force the next value (used in particular when resumeWith
  // is not null).
  let forceNext = resumeWith;

  /**
   * @param {number} blockNumber The number of a block.
   * @param {number} trialNumber The number of a trial in the block.
   * @return {Promise<{done, value}>} A promise that resolves with
   * the next task's value, and the status of the design iteration.
   */
  const next = () => {
    if (forceNext != null) {
      const value = forceNext;
      forceNext = null;
      return Promise.resolve({ value, done: false });
    }
    return Promise.resolve(tasksIterator.next());
  };

  /**
   * @return {Promise<string>} A promise that resolves with the id of the run.
   */
  const getId = () => Promise.resolve(runId);

  return { next, getId };
};
