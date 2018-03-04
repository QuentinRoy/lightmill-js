import { RunInterface } from '@lightmill/connection';
import runTrials from './run-trials';
import LocalValueStorage from './local-value-storage';
import { throwWithHeader } from './utils';

/**
 * Run an experiment.
 *
 * @param {Object} app The application of the experiment.
 * @param {function(): Promise} [app.start] Initialize the experiment.
 * @param {function(): Promise} [app.initRun] Initialize the run.
 * @param {function(): Promise} [app.initBlock] Initialize a block.
 * @param {function(): Promise} app.runTrial Run a trial.
 * @param {function(): Promise} [app.end] Called when the experiment ends.
 * @param {function(): Promise} [app.crash] Called if an error is thrown during
 * the run.
 * @param {Object} config Configuration.
 * @param {string} config.experimentId The id of the experiment. This is
 * required is config.connection is not provided.
 * @param {string} [config.runId] The id of a run to connect to.
 * @param {string} [config.serverAddress] The address of the xp server.
 * @param {string} [config.experimentDesignAddr] The path toward a touchstone
 * experiment design xml file.
 * @param {string} [config.queueSize] The maximum number of pending trial result
 * posts before starting a new trial.
 * @param {Object} [config.runStorage] Used to store the running run.
 * @param {Object} [config.connection] The connection to the server. You do not
 * usually need to provide this.
 * @returns {Promise} A promise resolved once the experiment is done.
 */
export default async (
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
) => {
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
};
