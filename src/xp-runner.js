import createRunConnection from './connection/run-connection';

// Create a copy of an error with a header appended to its message.
const errorWithHeader = (e, header) => {
  const err = new Error(e.message ? `${header}: ${e.message}` : header);
  err.original = e;
  err.stack = e.stack;
  if (e.type) err.type = e.type;
  return err;
};

// Return a function that will throw an error after appending a header.
const throwWithHeader = header => e => {
  throw errorWithHeader(e, header);
};

/* eslint-disable no-await-in-loop */
/**
 * Run the trials of an experiment.
 * @param  {Object}  connection  The connection to the run on the xp server.
 * @param  {Object}  app  The app of the experiment.
 * @param  {int}  queueSize  Max number of pending trial result posts before starting a new trial.
 * @return {Promise}  A promise resolved when all trials have run.
 */
const runTrials = async (connection, app, queueSize) => {
  // Init the loop.
  let trial = await connection
    .getCurrentTrial()
    .catch(throwWithHeader('Could not retrieve current trial info'));
  let block;

  while (trial) {
    // If the block has changed, init the new one.
    if (block !== trial.block) {
      block = trial.block;
      await Promise.resolve(app.initBlock && app.initBlock(block)).catch(
        throwWithHeader('Could not init block')
      );
    }

    // Make sure there is less than queueSize pending trial result posts before starting the
    // trial.
    await connection.flush(queueSize);

    // Run the trial and fetch the results.
    const results = await app.runTrial(trial);
    // Post the results.
    connection
      .endCurrentTrial(results)
      .catch(throwWithHeader('Could not register trial log'));

    // Fetch the next trial (resolve with undefined if there is no more trials).
    trial = await connection
      .getCurrentTrial()
      .catch(throwWithHeader('Could not retrieve current trial info'));
  }
  // Fully flush the post queue and disconnect from the server.
  await connection.flush();
};
/* eslint-enable no-await-in-loop */

/**
 * Run an experiment.
 * @param {Object} app The application of the experiment.
 * @param {function(): Promise} [app.start] Initialize the experiment.
 * @param {function(): Promise} [app.initRun] Initialize the run.
 * @param {function(): Promise} [app.initBlock] Initialize a block.
 * @param {function(): Promise} app.runTrial Run a trial.
 * @param {function(): Promise} [app.end] Notify that the experiment is finished.
 * @param {Object} config Configuration.
 * @param {string} [config.experimentId] The id of the experiment.
 *                                       This is required is config.connection is not provided.
 * @param {string} [config.serverAddress] The address of the xp server.
 * @param {string} [config.runId] The id of a run to connect to.
 * @param {string} [config.experimentDesignAddr] The path toward a touchstone
 *                                               experiment design xml file.
 * @param {Object} [config.connection] The connection to the server. This is required if config.
 *                                     experimentId is not provided
 */
const runExperiment = async (
  app,
  {
    experimentId,
    runId,
    experimentDesignAddr,
    queueSize = 1,
    serverAddress = `http://${window.location.hostname}:5000`,
    connection: potentialConnection
  }
) => {
  // The key where to store the current run id in the local storage.
  const runStorageKeyName = `${experimentId}/running-run-id`;
  // Create a promise toward the run connection.
  const connectionPromise =
    potentialConnection ||
    createRunConnection(
      serverAddress,
      experimentId,
      runId || localStorage.getItem(runStorageKeyName),
      experimentDesignAddr
    );
  // Connect to the run and start the app.
  const [connection, run] = await Promise.all([
    connectionPromise,
    connectionPromise
      .then(runConnection => runConnection.getRun())
      .then(run_ => {
        // Set a local storage entry so that while the run is not finished, the browser will
        // always attempt to connect back to it.
        localStorage.setItem(runStorageKeyName, run_.id);
        return run_;
      }, throwWithHeader('Could not connect to the experiment')),
    // Start the experiment app.
    Promise.resolve(app.start && app.start()).catch(
      throwWithHeader('Could not init the experiment task')
    )
  ]);
  // Ask the app to init the run.
  await Promise.resolve(app.initRun && app.initRun(run)).catch(
    throwWithHeader('Could not init the run task')
  );
  // Run the trials.
  await runTrials(connection, app, queueSize);
  // Clear the local storage so that next time the page is loaded, a new run will be requested.
  localStorage.clear();
  // Disconnect from the server.
  await connection.disconnect();
  // Notify the app that the experiment is finished.
  await app.end();
};

export default runExperiment();
