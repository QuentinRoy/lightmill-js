import deepFreeze from 'deep-freeze';
import ServerInterface from './server-interface';
import PromiseQueue from './promise-queue';

/**
 * Select a run from the server.
 * @param  {ServerInterface} serverInterface The server interface.
 * @param  {string} experimentId The id of the experiment.
 * @param  {string} [runId] The id of a target run.
 * @return {Promise} A promise resolved with the information about the run.
 */
export async function selectRun(serverInterface, experimentId, runId) {
  const runInfo = runId
    ? await serverInterface.run(experimentId, runId)
    : await serverInterface.availableRun(experimentId);
  // Check if the ids are consistent.
  if (runInfo.experimentId !== experimentId) {
    throw new Error(
      'Received experiment id is inconsistent with the one that has been requested.'
    );
  } else if (runId && runInfo.id !== runId) {
    throw new Error(
      'Received run id is inconsistent with the one that has been requested.'
    );
  }
  return runInfo;
}

/**
 * Connect to a run (and lock it on the server)
 * @param  {ServerInterface} serverInterface The server interface.
 * @param  {Object} runInfo The description of the target run.
 * @return {Promise<{id, experimentId, blocks, currentTrial, lock}>} The run
 * information.
 */
export async function connectToRun(serverInterface, runInfo) {
  // Lock it, fetch the run plan and the current trial (current trial might not
  // be the first on if the run is being resumed).
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
 * Check if an experiment is loaded on the server and attempts to import it if
 * not.
 * @param {ServerInterface} serverInterface The server interface.
 * @param {string} experimentId The id of the experiment to look for.
 * @param {string} [experimentDesignURI] The URL of an experiment design xml
 * file.
 * @throws {Error} If the experiment is not loaded and no experiment design URI
 * is provided, of if the connection with the server fails.
 * @return {Promise} Resolves one the experiment is properly loaded on the
 * server.
 */
export async function checkExperimentAndImportIfNeeded(
  serverInterface,
  experimentId,
  experimentDesignURI
) {
  const isLoaded = await serverInterface.isExperimentLoadedOnServer(
    experimentId
  );
  // Check if the experiment is loaded on the server, and if not load it.
  if (!isLoaded) {
    if (experimentDesignURI) {
      await serverInterface.importExperimentOnServer(experimentDesignURI);
    } else {
      throw new Error(
        `The experiment ${experimentId} is not loaded on the server and the design URI is not provided.`
      );
    }
  }
}

/**
 * Consolidate a run by appending back references toward block on trials, and
 * back references toward the run on blocks
 * @param {{id, experimentId, blocks}} runInfo The description of the run.
 * @return {{id, experimentId, blocks}} The run consolidated and frozen.
 */
export function consolidateRun(runInfo) {
  const run = {
    id: runInfo.id,
    experimentId: runInfo.experimentId
  };
  // Insert backrefs to the parent block on each trials, and backrefs to the run
  // on each blocks.
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
 * @constructor RunInterface
 * @param {Object} run The run model.
 * @param {string} token The access token to the run.
 * @param {int} startBlockNum The number of the first block to run.
 * @param {int} startTrialNum The number of the first trial to run.
 * @param {PromiseQueue} promiseQueue The promise queue to use to queue
 * server request.
 * @param {function} postTrialResults The function to call to post trial
 * results.
 */
export default function RunInterface(
  run,
  token,
  startBlockNum,
  startTrialNum,
  promiseQueue,
  postTrialResults
) {
  // Maintain the current trial.
  let currentTrial = run.blocks[startBlockNum].trials[startTrialNum];
  // Register the promise of the last trial result post request. Used to make
  // sure a post request is done before sending a new one.
  let lastTrialResultPost;
  // Register if results have been posted for the current trial.
  let areCurrentTrialResultsPosted = false;

  /**
   * @return {Promise<Object>} A promise that resolves with the connected run.
   */
  this.getRun = async () => run;

  /**
   * @return {Promise<Object>} A promise that resolves with the current block.
   */
  this.getCurrentBlock = async () => currentTrial && currentTrial.block;

  /**
   * @return {Promise} A promise that resolves with the current trial.
   */
  this.getCurrentTrial = async () => currentTrial;

  /**
   * @return {Promise} A promise that resolves with the next trial.
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
   * @return {Promise} A promise resolved once the interface is disconnected
   * (actually doesn't do anything)
   */
  this.disconnect = async () => {};

  this.postResults = async measures => {
    if (areCurrentTrialResultsPosted) {
      throw new Error(
        'Results have already been posted for the current trial.'
      );
    }
    areCurrentTrialResultsPosted = true;
    // Update the current trial.
    const trial = await this.getCurrentTrial();
    if (!trial) {
      throw new Error(
        'Cannot post trial results: current trial is unknown. It might be because the run is not connected or it is already finished.'
      );
    }
    // Post the results.
    lastTrialResultPost = Promise.resolve(lastTrialResultPost).then(() =>
      postTrialResults(
        run.experimentId,
        run.id,
        trial.block.number,
        trial.number,
        { token, measures }
      )
    );
    // Push the post promise in the queue to monitor unfinished posts.
    promiseQueue.push(lastTrialResultPost);
    return lastTrialResultPost;
  };

  /**
   * End a trial by posting its result to the server.
   * @param  {Object}  measures The trial result.
   * @return {Promise} A promise resolved when the trial results have been
   * successful pushed to the server
   */
  this.endTrial = async () => {
    if (!areCurrentTrialResultsPosted) {
      throw new Error(
        'Cannot end current trial, no results have been posted yet.'
      );
    }
    // Update the current trial.
    currentTrial = await this.getNextTrial();
    areCurrentTrialResultsPosted = false;
    // Return the post promise.
    return currentTrial;
  };

  /**
   * Flush the trial result post queue.
   * @param  {int} maxLength The maximum number of pending trial result post
   * requests before resolving the promise
   * @return {Promise} A promise that resolves when there is maxLength or less
   * pending trial results. Resolves immediately if this is already the case
   * when the function is called.
   */
  this.flush = maxLength => promiseQueue.flush(maxLength);
}

/**
 * Create a connection to a run.
 * @param  {string|Object} serverAddressOrInterface The address of the server.
 * Alternatively, this can be provided as a server interface.
 * @param  {string} experimentId The id of the experiment.
 * @param  {string} [runId]  The id of the run.
 * @param  {string} [experimentDesignURI] The address of the experiment design
 * (used to) import the experiment on the server if not already loaded.
 * @param  {PromiseQueue} [postQueue=new PromiseQueue()] Post queue that will
 * monitor pending result posts.
 * @return {Promise<Object>} The run connection.
 */
RunInterface.create = async function createRunInterface(
  serverAddressOrInterface,
  experimentId,
  runId,
  experimentDesignURI,
  postQueue = new PromiseQueue()
) {
  // Create the interface to the server.
  const serverInterface =
    typeof serverAddressOrInterface === 'string'
      ? new ServerInterface(serverAddressOrInterface)
      : serverAddressOrInterface;

  // Make sure the experiment is properly loaded on the server.
  await checkExperimentAndImportIfNeeded(
    serverInterface,
    experimentId,
    experimentDesignURI
  );

  // Connect to the run.
  const runInfo = await connectToRun(
    serverInterface,
    await selectRun(serverInterface, experimentId, runId)
  );

  // Consolidate the run (insert backrefs to blocks in trials and run in blocks,
  // and deep freeze everything).
  const run = consolidateRun(runInfo);

  return new RunInterface(
    run,
    runInfo.lock.token,
    runInfo.currentTrial.blockNumber,
    runInfo.currentTrial.number,
    postQueue,
    serverInterface.postTrialResults.bind(serverInterface)
  );
};
