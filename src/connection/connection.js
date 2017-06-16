import fetchPonyfill from 'fetch-ponyfill';
import defaultConfig from '../default-config';
import getServerInterface from './server-interface';
import PromiseQueue from './promise-queue';

const { fetch } = fetchPonyfill();

// Return a new object with the properties of the objects given as arguments.
const merged = (...objects) => Object.assign({}, ...objects);

const consolidateRun = (run, blocks) => {
  const newRun = {
    id: run.id,
    experimentId: run.experimentId
  };
  newRun.blocks = blocks.map((block) => {
    const newBlock = merged(block, { run: newRun });
    newBlock.trials = block.trials.map(trial => merged(trial, { block: newBlock }));
    return newBlock;
  });
  return newRun;
};

export default class RunConnection {
  constructor() {
    // Registers the asynchronous members of the connection.
    this._interface = undefined;
    this._run = undefined;
    this._lock = undefined;
    this._currentTrial = undefined;
    this._postQueue = undefined;
    this._isIdle = true;
  }

  getRun() {
    return this._run;
  }

  getCurrentTrial() {
    return this._currentTrial;
  }

  getCurrentBlock() {
    const currentTrial = this.getCurrentTrial();
    return currentTrial && currentTrial.block;
  }

  isRunning() {
    return !!this._currentTrial;
  }

  async connect(
    serverAddress = defaultConfig.serverAddress,
    targetXp = defaultConfig.experiment,
    targetRun = undefined,
    experimentDesignPath
  ) {
    if (!this._isIdle) {
      throw new Error('Run already connected or being connected.');
    }
    this._isIdle = false;
    // Create the server interface.
    const serverInterface = await getServerInterface(serverAddress);

    // Check if the target experiment is loaded in the server and try to load if available.
    const experiments = await serverInterface.experiments();
    if (!experiments[targetXp]) {
      if (experimentDesignPath) {
        const expeDesign = await fetch(experimentDesignPath).then(resp => resp.text());
        await serverInterface.postExperimentDesign(expeDesign);
      } else {
        throw new Error(
          `Target experiment (${this._targetXp}) is not loaded on the server ` +
            'and the experiment design is not locally available'
        );
      }
    }

    // Fetch the target run if specified else, request for an available one.
    const runInfo = await (targetRun
      ? serverInterface.run(targetXp, targetRun)
      : serverInterface.availableRun(targetXp));

    // Lock it, fetch the run plan and the current trial (current trial might not be the first
    // on if the run is being resumed).
    const [lock, blocks, currentTrial] = await Promise.all([
      serverInterface.lock(runInfo.experimentId, runInfo.id),
      serverInterface.plan(runInfo.experimentId, runInfo.id),
      serverInterface.currentTrial(runInfo.experimentId, runInfo.id)
    ]);

    // Set up the local properties.
    this._postQueue = new PromiseQueue();
    this._interface = serverInterface;
    // Insert backrefs to the parent block on each trials, and backrefs to the run on each
    // blocks.
    this._run = consolidateRun(runInfo, blocks);
    this._lock = lock;
    this._currentTrial = this._run.blocks[currentTrial.blockNumber].trials[currentTrial.number];
    return this._run;
  }

  disconnect() {
    // Clear everything.
    this._interface = undefined;
    this._run = undefined;
    this._lock = undefined;
    this._currentTrial = undefined;
    this._postQueue = undefined;
    this._isIdle = true;
  }

  async endCurrentTrial(measures) {
    const previousTrial = this._currentTrial;
    if (!previousTrial) {
      throw new Error(
        'Cannot end current trial: it is unknown. ' +
          ' It might be because the run is not connected or it is already finished.'
      );
    }
    // Create the result object to send to the server.
    const run = this.getRun();
    // Update the current trial.
    const newCurrentTrial = this.getNextTrial();
    this._currentTrial = newCurrentTrial;

    // Post the results.
    const postProm = Promise.resolve(this._postQueue.last).then(() =>
      this._interface.postTrialResults(
        run.experimentId,
        run.id,
        previousTrial.block.number,
        previousTrial.number,
        { token: this._lock.token, measures }
      )
    );

    // Push the post promise in the queue to monitor unfinished posts.
    this._postQueue.push(postProm);
    await postProm;
    return newCurrentTrial;
  }

  flush(maxLength) {
    return this._postQueue.flush(maxLength);
  }

  getNextTrial() {
    let nextTrialNum = this.getCurrentTrial().number + 1;
    let currentBlock = this.getCurrentBlock();
    if (nextTrialNum >= currentBlock.trials.length) {
      currentBlock = this._run.blocks[currentBlock.number + 1];
      nextTrialNum = 0;
    }
    if (!currentBlock) {
      return undefined;
    }
    return currentBlock.trials[nextTrialNum];
  }
}
