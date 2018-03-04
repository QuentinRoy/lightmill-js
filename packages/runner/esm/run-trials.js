import { throwWithHeader, errorWithHeader } from './utils';

/**
 * Run the trials of an experiment.
 * @param  {Object}  connection  The connection to the run on the lightmill
 * server.
 * @param  {Object}  app  The app of the experiment.
 * @param  {int}  queueSize  Max number of pending trial result posts before
 * starting a new trial.
 * @return {Promise}  A promise resolved when all trials have run.
 */
export default async (connection, app, queueSize) =>
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
