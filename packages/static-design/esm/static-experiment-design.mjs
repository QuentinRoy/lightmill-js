import RunIterator from './run-iterator.mjs';

export default (experimentalDesign) => ({
  /**
   * @param {string[]} startedRuns The list of runs that has already been
   * started (even if they may not all have completed yet).
   * @return {string[]} A list of run liable to be taken.
   */
  getAvailableRuns(startedRuns) {
    return Promise.resolve(
      experimentalDesign.runs
        .map((r) => r.id)
        .filter((runId) =>
          startedRuns.every((startedRunId) => startedRunId !== runId)
        )
    );
  },

  /**
   * @param {string} runId The id of the target run.
   * @param {object} options Options to start the run.
   * @param {object} options.resumeAfter The id of the last task (e.g. the
   * last trial) to resume the run after.
   * @return {{next, getId}} A run iterator.
   */
  startRun(runId, options) {
    const run = experimentalDesign.runs.find((r) => r.id === runId);
    if (!run) {
      return Promise.reject(new Error(`Cannot find run with id ${runId}`));
    }
    return Promise.resolve(RunIterator(run, options));
  },

  /**
   * @return {string} The id of the experiment.
   */
  getId() {
    return Promise.resolve(experimentalDesign.id);
  },
});
