import fetch from 'unfetch';
// eslint-disable-next-line import/no-extraneous-dependencies
import deepFreeze from 'deep-freeze'; // This is a devDependency because it is bundled in.
import ServerInterface from './server-interface';
import PromiseQueue from './promise-queue';

/**
 * Check if the target experiment is loaded on the server.
 * @param  {Object}  serverInterface the server interface.
 * @param  {string}  experimentId    the id of the target experiment.
 * @return {Promise}                 true if the experiment is loaded on the server.
 */
export async function isExperimentLoadedOnServer(
  serverInterface,
  experimentId
) {
  const experiments = await serverInterface.experiments();
  return !!experiments[experimentId];
}

/**
 * Fetch the given experiment design xml file and post it to be imported on the server.
 * @param  {Object}  serverInterface      the server interface.
 * @param  {string}  experimentDesignAddr the address where to download the experiment design.
 * @return {Promise}                      resolves when the experiment has been imported.
 */
export async function importExperimentOnServer(
  serverInterface,
  experimentDesignAddr
) {
  const designReq = await fetch(experimentDesignAddr);
  const design = await designReq.text();
  return serverInterface.postExperimentDesign(design);
}

/**
 * Select a run from the server.
 * @param  {Object}  serverInterface
 * @param  {string}  experimentId
 * @param  {string}  [runId]
 * @return {Promise}
 */
export async function selectRun(serverInterface, experimentId, runId) {
  const runInfo = runId
    ? await serverInterface.run(experimentId, runId)
    : await serverInterface.availableRun(experimentId);
  // Check if the ids are consistant.
  if (runInfo.experimentId !== experimentId) {
    throw new Error(
      'Received experiment id is inconsistant with the one that has been requested.'
    );
  } else if (runId && runInfo.id !== runId) {
    throw new Error(
      'Received run id is inconsistant with the one that has been requested.'
    );
  }
  return runInfo;
}

/**
 * Connect to a run (and lock it on the server)
 * @param  {Object}  serverInterface The server interface.
 * @param  {Object}  runInfo         The description of the target run.
 * @return {Promise<{id, experimentId, blocks, currentTrial, lock}>} The run information.
 */
export async function connectToRun(serverInterface, runInfo) {
  // Lock it, fetch the run plan and the current trial (current trial might not be the first
  // on if the run is being resumed).
  const [lock, blocksInfo, currentTrialInfo] = await Promise.all([
    serverInterface.lock(runInfo.experimentId, runInfo.id),
    serverInterface.plan(runInfo.experimentId, runInfo.id),
    serverInterface.currentTrial(runInfo.experimentId, runInfo.id)
  ]);

  return {
    id: runInfo.id,
    experimentId: runInfo.experimentId,
    blocks: blocksInfo,
    currentTrial: currentTrialInfo,
    lock
  };
}

/**
 * Consolidate a run by appending back references toward block on trials, and back references
 * toward the run on blocks
 * @param  {{id, experimentId, blocks}} runInfo The description of the run.
 * @return {{id, experimentId, blocks}}         The run consolidated and frozen.
 */
export function consolidateRun(runInfo) {
  const run = {
    id: runInfo.id,
    experimentId: runInfo.experimentId
  };
  // Insert backrefs to the parent block on each trials, and backrefs to the run on each
  // blocks.
  run.blocks = runInfo.blocks.map(block => {
    const newBlock = Object.assign({}, block, { run });
    newBlock.trials = block.trials.map(trial =>
      Object.assign({}, trial, { block: newBlock })
    );
    return newBlock;
  });
  deepFreeze(run);
  return run;
}

/**
 * RunConnection class.
 * @param  {string} run
 * @param  {string} token
 * @param  {int} startTrialNum
 * @param  {int} startBlockNum
 * @param  {PromiseQueue} postQueue
 * @param  {function} postTrialResults
 * @return {RunConnection}
 */
export default function RunConnection(
  run,
  token,
  startBlockNum,
  startTrialNum,
  postQueue,
  postTrialResults
) {
  // Maintain the current trial.
  let currentTrial = run.blocks[startBlockNum].trials[startTrialNum];
  // Register the promise of the last trial result post request. Used to make sure a post request
  // is done before sending a new one.
  let lastTrialResultPost;
  // Create the connection object.

  /**
   * Resolves with the connected run.
   * @return {Promise<Object>}
   */
  this.getRun = async () => run;

  /**
   * Resolves with the current block.
   * @return {Promise<Object>}
   */
  this.getCurrentBlock = async () => currentTrial && currentTrial.block;

  /**
   * Resolves with the current trial.
   * @return {Promise}
   */
  this.getCurrentTrial = async () => currentTrial;

  /**
   * Resolves with the next trial.
   * @return {Promise}
   */
  this.getNextTrial = async () => {
    let nextTrialNum = currentTrial.number + 1;
    let currentBlock = currentTrial.block;
    if (nextTrialNum >= currentBlock.trials.length) {
      currentBlock = run.blocks[currentBlock.number + 1];
      nextTrialNum = 0;
    }
    if (!currentBlock) {
      return undefined;
    }
    return currentBlock.trials[nextTrialNum];
  };

  /**
   * Disconnect (does nothing).
   * @return {Promise}
   */
  this.disconnect = async () => {
    // Nothing to do here.
  };

  /**
   * End a trial by posting its result to the server.
   * @param  {Object}  measures   The trial result.
   * @return {Promise}            A promise resolved when the trial results have been successfuly
   *                              pushed to the server
   */
  this.endCurrentTrial = async measures => {
    const previousTrial = await this.getCurrentTrial();
    if (!previousTrial) {
      throw new Error(
        'Cannot end current trial: it is unknown. ' +
          ' It might be because the run is not connected or it is already finished.'
      );
    }
    // Update the current trial.
    currentTrial = await this.getNextTrial();
    // Post the results.
    lastTrialResultPost = Promise.resolve(lastTrialResultPost).then(() =>
      postTrialResults(
        run.experimentId,
        run.id,
        previousTrial.block.number,
        previousTrial.number,
        { token, measures }
      )
    );
    // Push the post promise in the queue to monitor unfinished posts.
    postQueue.push(lastTrialResultPost);
    return currentTrial;
  };

  /**
   * Flush the trial result post queue.
   * @param  {int} maxLength  The maximum number of pending trial result post requests before
   *                          resolving the promise
   * @return {Promise}        A promise that resolves when there is maxLength or less pending
   *                          trial results. Resolves immediately if this is already the case
   *                          when the function is called.
   */
  this.flush = maxLength => postQueue.flush(maxLength);
}

/**
 * Create a connection to a run.
 * @param  {string|Object} serverAddressOrInterface The address of the server. Alternatively,
 *                                                  this can be provided as a server interface.
 * @param  {string}       experimentId The id of the experiment.
 * @param  {string}       [runId]  The id of the run.
 * @param  {string}       [experimentDesignAddr] The address of the experiment design (used to)
 *                                               import the experiment on the server if not already
 *                                               loaded.
 * @param  {PromiseQueue} [postQueue=new PromiseQueue()] Post queue that will monitor pending result
 *                                                       posts.
 * @return {Promise<Object>} The run connection.
 */
RunConnection.create = async function createRunConnection(
  serverAddressOrInterface,
  experimentId,
  runId,
  experimentDesignAddr,
  postQueue = new PromiseQueue()
) {
  // Create the interface to the server.
  const serverInterface = typeof serverAddressOrInterface === 'string'
    ? new ServerInterface(serverAddressOrInterface)
    : serverAddressOrInterface;

  // Check if the experiment is loaded on the server, and if not load it.
  // prettier-ignore
  if (!(await isExperimentLoadedOnServer(serverInterface, experimentId))) {
    await importExperimentOnServer(serverInterface, experimentDesignAddr);
  }

  // Connect to the run.
  const runInfo = await connectToRun(
    serverInterface,
    await selectRun(serverInterface, experimentId, runId)
  );

  // Consolidate the run (insert backrefs to blocks in trials and run in blocks, and deep freeze
  // everything).
  const run = consolidateRun(runInfo);

  return new RunConnection(
    run,
    runInfo.lock.token,
    runInfo.currentTrial.blockNumber,
    runInfo.currentTrial.number,
    postQueue,
    serverInterface.postTrialResults.bind(serverInterface)
  );
};