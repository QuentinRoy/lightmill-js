import { RunInterface } from 'lightmill-connection';
import LocalValueStorage from './local-value-storage';

// Create a copy of an error with a header appended to its message.
function errorWithHeader(e, header) {
  const err = new Error(e.message ? `${header}: ${e.message}` : header);
  err.original = e;
  err.stack = e.stack;
  if (e.type) err.type = e.type;
  return err;
}

// Return a function that will throw an error after appending a header.
function throwWithHeader(header) {
  return e => {
    throw errorWithHeader(e, header);
  };
}

/**
 * Run the trials of an experiment.
 * @param  {Object}  connection  The connection to the run on the lightmill
 * server.
 * @param  {Object}  app  The app of the experiment.
 * @param  {int}  queueSize  Max number of pending trial result posts before
 * starting a new trial.
 * @return {Promise}  A promise resolved when all trials have run.
 */
export const runTrials = async (connection, app, queueSize) =>
  new Promise(async (resolve, reject) => {
    try {
      // Init the loop.
      let trial = await connection
        .getCurrentTrial()
        .catch(throwWithHeader('Could not retrieve current trial info'));
      let block;

      /* eslint-disable no-await-in-loop */
      while (trial) {
        // If the block has changed, init the new one.
        if (block !== trial.block) {
          block = trial.block; // eslint-disable-line prefer-destructuring
          await Promise.resolve(app.initBlock && app.initBlock(block)).catch(
            throwWithHeader('Could not init block')
          );
        }

        // Make sure there is less than queueSize pending trial result posts
        // before starting the trial.
        await connection.flush(queueSize);

        // Run the trial and fetch the results.
        const results = await app.runTrial(trial);

        // Post the results (without waiting).
        connection
          .postResults(results)
          .catch(e =>
            reject(errorWithHeader(e, 'Could not post trial results'))
          );
        // End the trial.
        trial = await connection
          .endTrial()
          .catch(throwWithHeader('Could not switch to next trial'));
      }
      /* eslint-enable no-await-in-loop */

      // Fully flush the post queue.
      await connection.flush();
      resolve();
    } catch (e) {
      reject(e);
    }
  });

/**
 * Run an experiment.
 * @param {Object} app The application of the experiment.
 * @param {function(): Promise} [app.start] Initialize the experiment.
 * @param {function(): Promise} [app.initRun] Initialize the run.
 * @param {function(): Promise} [app.initBlock] Initialize a block.
 * @param {function(): Promise} app.runTrial Run a trial.
 * @param {function(): Promise} [app.end] Called when the experiment ends.
 * @param {function(): Promise} [app.crash] Called if an error is thrown during
 * the run.
 * @param {Object} config Configuration.
 * @param {string} config.experimentId The id of the experiment.
 *                                     This is required is config.connection is
 * not provided.
 * @param {string} [config.runId] The id of a run to connect to.
 * @param {string} [config.serverAddress] The address of the xp server.
 * @param {string} [config.experimentDesignAddr] The path toward a touchstone
 *                                               experiment design xml file.
 * @param {string} [config.queueSize] The maximum number of pending trial result
 * posts before starting a new trial.
 * @param {Object} [config.runStorage] Used to store the running run.
 * @param {Object} [config.connection] The connection to the server. You do not
 * usually need to provide this.
 * @returns {Promise} A promise resolved once the experiment is done.
 */
export async function runExperiment(
  app,
  {
    experimentId,
    runId,
    serverAddress,
    experimentDesignAddr,
    queueSize = 1,
    // Test arguments.
    runStorage = new LocalValueStorage(`${experimentId}/running-run-id`),
    connection: potentialConnection = RunInterface.create(
      serverAddress || `http://${window.location.hostname}:5000`,
      experimentId,
      runId || runStorage.get(),
      experimentDesignAddr
    )
  }
) {
  let run_; // eslint-disable-line no-underscore-dangle
  try {
    // Returns a promise that initializes the connection and registers the run.
    const initConnection = async () => {
      const connection = await potentialConnection;
      const run = await connection.getRun();
      runStorage.set(run.id);
      return { connection, run };
    };
    // Connect to the run and start the app.
    const [{ connection, run }] = await Promise.all([
      initConnection().catch(
        throwWithHeader('Could not connect to the experiment')
      ),
      // Start the experiment app.
      Promise.resolve(app.start && app.start()).catch(
        throwWithHeader("Could not start the experiment's app")
      )
    ]);
    // Export the run out of the context for the catch clause.
    run_ = run;
    // Ask the app to init the run.
    await Promise.resolve(app.initRun && app.initRun(run)).catch(
      throwWithHeader('Could not init the run task')
    );
    // Run the trials.
    await runTrials(connection, app, queueSize);
    // Clear the local storage so that next time the page is loaded, a new run
    // will be requested.
    runStorage.remove();
    // Disconnect from the server.
    await connection.disconnect();
    // Notify the app that the experiment is finished.
    if (app.end) await app.end();
  } catch (e) {
    if (app.crash) app.crash(e.message, e, run_);
    throw e;
  }
}

export default runExperiment;