import fetch from 'unfetch';
import deepFreeze from 'deep-freeze';
import getServerInterface from './server-interface';
import PromiseQueue from './promise-queue';

/**
 * Check if the target experiment is loaded on the server.
 * @param  {Object}  serverInterface the server interface.
 * @param  {string}  experimentId    the id of the target experiment.
 * @return {Promise}                 true if the experiment is loaded on the server.
 */
export const isExperimentLoadedOnServer = async (
  serverInterface,
  experimentId
) => {
  const experiments = await serverInterface.experiments();
  return !!experiments[experimentId];
};

/**
 * [importExperimentOnServer description]
 * @param  {Object}  serverInterface      the server interface.
 * @param  {string}  experimentDesignAddr the address where to downlad the experiment design.
 * @return {Promise}                      resolves when the experiment has been imported.
 */
export const importExperimentOnServer = async (
  serverInterface,
  experimentDesignAddr
) => {
  const designReq = await fetch(experimentDesignAddr);
  const design = await designReq.text();
  return serverInterface.postExperimentDesign(design);
};

/**
 * Connect to a run (and lock it on the server)
 * @param  {Object}  serverInterface The server interface.
 * @param  {string}  experimentId    The id of the target experiment.
 * @param  {string}  [runId]         The id of the target run. If undefined, asks for an available
 *                                   one.
 * @return {Promise<{id, experimentId, blocks, currentTrial, lock}>} The run information.
 */
export const connectToRun = async (
  serverInterface,
  experimentId,
  targetRun
) => {
  // Fetch the target run if specified else, request for an available one.
  const runInfo = await (targetRun
    ? serverInterface.run(experimentId, targetRun)
    : serverInterface.availableRun(experimentId));

  // Lock it, fetch the run plan and the current trial (current trial might not be the first
  // on if the run is being resumed).
  const [lock, blocksInfo, currentTrialInfo] = await Promise.all([
    serverInterface.lock(runInfo.experimentId, runInfo.id),
    serverInterface.plan(runInfo.experimentId, runInfo.id),
    serverInterface.currentTrial(runInfo.experimentId, runInfo.id)
  ]);

  const run = {
    id: runInfo.id,
    experimentId: runInfo.experimentId,
    lock
  };
  // Insert backrefs to the parent block on each trials, and backrefs to the run on each
  // blocks.
  run.blocks = blocksInfo.map(block => {
    const newBlock = Object.assign({}, block, { run });
    newBlock.trials = block.trials.map(trial =>
      Object.assign({}, trial, { block: newBlock })
    );
    return newBlock;
  });
  // Register the current trial.
  run.currentTrial =
    run.blocks[currentTrialInfo.blockNumber].trials[currentTrialInfo.number];
  return run;
};

/**
 * Create a connection to a run.
 * @param  {string|Object} serverAddress The address of the server. Alternatively, this can be
 *                                       provided as a server interface.
 * @param  {string}       experimentId The id of the experiment.
 * @param  {string}       [runId]  The id of the run.
 * @param  {string}       [experimentDesignAddr] The address of the experiment design (used to)
 *                                               import the experiment on the server if not already
 *                                               loaded.
 * @param  {PromiseQueue} [postQueue=new PromiseQueue()] Post queue that will monitor pending result
 *                                                       posts.
 * @return {Promise<Object>} The run connection.
 */
const createRunConnection = async (
  serverAddress,
  experimentId,
  targetRun,
  experimentDesignAddr,
  postQueue = new PromiseQueue()
) => {
  // Create the interface to the server.
  const serverInterface = typeof serverAddress === 'string'
    ? await getServerInterface(serverAddress)
    : serverAddress;

  // Check if the experiment is loaded on the server, and if not load it.
  if (await isExperimentLoadedOnServer(serverInterface, experimentId)) {
    await importExperimentOnServer(serverInterface, experimentId);
  }

  // Connect to the run.
  const runInfo = await connectToRun(serverInterface, experimentId, targetRun);

  const run = deepFreeze({
    id: runInfo.id,
    blocks: runInfo.blocks
  });

  // The current trial.
  let currentTrial = runInfo.currentTrial;
  // Server lock required to update the current run on the server.
  const lock = runInfo.lock;
  // Register the promise of the last trial result post request. Used to make sure a post request
  // is done before sending a new one.
  let lastTrialResultPost;

  // Create the connection object.
  return {
    async getRun() {
      return run;
    },

    async getCurrentBlock() {
      return currentTrial && currentTrial.block;
    },

    async getCurrentTrial() {
      return currentTrial;
    },

    async getNextTrial() {
      let nextTrialNum = this.getCurrentTrial().number + 1;
      let currentBlock = this.getCurrentBlock();
      if (nextTrialNum >= currentBlock.trials.length) {
        currentBlock = this.getRun().blocks[currentBlock.number + 1];
        nextTrialNum = 0;
      }
      if (!currentBlock) {
        return undefined;
      }
      return currentBlock.trials[nextTrialNum];
    },

    async disconnect() {
      // Nothing to do here.
    },

    async endCurrentTrial(measures) {
      const previousTrial = this.getCurrentTrial();
      if (!previousTrial) {
        throw new Error(
          'Cannot end current trial: it is unknown. ' +
            ' It might be because the run is not connected or it is already finished.'
        );
      }
      // Update the current trial.
      currentTrial = this.getNextTrial();
      // Post the results.
      lastTrialResultPost = Promise.resolve(lastTrialResultPost).then(() =>
        serverInterface.postTrialResults(
          run.experimentId,
          run.id,
          previousTrial.block.number,
          previousTrial.number,
          { token: lock.token, measures }
        )
      );
      // Push the post promise in the queue to monitor unfinished posts.
      postQueue.push(lastTrialResultPost);
      // Await for the trial results to be recorded on the server before resolving.
      await lastTrialResultPost;
      return currentTrial;
    },

    flush(maxLength) {
      return postQueue.flush(maxLength);
    }
  };
};

export default createRunConnection;
