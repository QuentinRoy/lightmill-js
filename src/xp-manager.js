import StateMachine from 'javascript-state-machine';
import XpConnection from './connection/connection';
import BlockInitView from './views/block-init';
import WaitView from './views/wait';
import CrashView from './views/crash';
import defaultConfig from './default-config';

// Create a copy of an error with a header appended to its message.
const errorWithHeader = (e, header) => {
  const err = new Error(e.message ? `${header}: ${e.message}` : header);
  err.original = e;
  err.stack = e.stack;
  if (e.type) err.type = e.type;
  return err;
};


/**
 * Arguments are in the form {taskManager, mainDiv, targetDiv}
 * Everything is facultative but taskManager.
 * Alternatively, taskManager can be given as first argument.
 */
export default class XPManager {
  constructor(taskManager, config) {
    const config_ = Object.assign({ taskManager }, defaultConfig, config);
    this._mainDiv = config_.mainDiv;
    this._taskManager = config_.taskManager;
    this._trialResultPromise = null;
    this._currentTrial = null;
    this._blockInitView = config_.blockInitView || new BlockInitView(this._mainDiv);
    this._waitView = config_.waitView || new WaitView(this._mainDiv);
    this._crashView = config_.crashView || new CrashView(this._mainDiv);
    this._connection = config_.connection || new XpConnection();
    this._targetRun = config_.run;
    this._serverAddress = config_.serverAddress;
    this._experimentId = config_.experiment;
    this._experimentFile = config_.experimentFile;
    this._subjectiveAssessment = config_.subjectiveAssessment;
    // This define the max number of pending trial post. A value of 0 enforces that the results of
    // a trial is fully recorded on the server before starting the next one. A value of x allows
    // x pending trial posts before starting a trial.
    this._queueSize = config_.queueSize;

    if (config_.debug.managerfsm) {
      this._onBeforeEvent = (name, from, to) => {
        console.log(`XP MANAGER FSM: ${name}: ${from} -> ${to}`);
      };
    }

    this._fsm = StateMachine.create({
      initial: 'idle',
      /* eslint-disable no-multi-spaces */
      events: [
        { name: 'start',        from: 'idle',           to: 'init'          },
        { name: 'runloaded',    from: 'init',           to: 'blockloading'  },
        { name: 'blockloaded',  from: 'blockloading',   to: 'blockinit'     },
        { name: 'xpend',        from: 'blockloading',   to: 'completed'     },
        { name: 'trialloaded',  from: 'trialloading',   to: 'trialrunning'  },
        { name: 'trialend',     from: 'trialrunning',   to: 'trialloading'  },
        { name: 'blockend',     from: 'trialrunning',   to: 'blockloading'  },
        { name: 'startblock',   from: 'blockinit',      to: 'trialloading'  },
        { name: 'xpend',        from: 'trialrunning',   to: 'completed'     },
        { name: 'connecterror', from: '*',              to: 'crashed'       },
        { name: 'taskerror',    from: '*',              to: 'crashed'       },
        { name: '*',            from: 'crashed'                             }
      ],
      /* eslint-enable no-multi-spaces */
      callbacks: this._getFsmCallbacks()
    });
  }
  start() {
    this._fsm.start();
  }

  _onInit() {
    // The key to fetch and store the name of the assigned run while the experiment is running.
    const runStorageKeyName = `${this._experimentId}/running-run-id`;

    // Show the waiting view.
    this._waitView.show();

    // Connect the run.
    const connectionPromise = this._connection
      .connect(
        this._serverAddress,
        this._experimentId,
        this._targetRun || localStorage.getItem(runStorageKeyName),
        this._experimentFile
      )
      .then(
        (run) => {
          // Set a local storage entry so that while the run is not finished, the browser will
          // always attempt to connect back to it.
          localStorage.setItem(runStorageKeyName, run.id);
          // Update the window title.
          window.document.title += ` (${run.id})`;
          return run;
        },
        (e) => {
          throw errorWithHeader(e, 'Could not connect to the experiment');
        }
      );

    // Init the experiment (at the same time).
    const initExperimentPromise = Promise.resolve(
      this._taskManager.loadExperiment && this._taskManager.loadExperiment()
    )
      .catch((e) => {
        throw errorWithHeader(e, 'Could not load the experiment task');
      })
      .then(() => {
        if (!this._taskManager.initExperiment) return undefined;
        this._waitView.hide();
        return this._taskManager.initExperiment().then(() => {
          this._waitView.show();
        });
      })
      .catch((e) => {
        throw errorWithHeader(e, 'Could not init the experiment task');
      });

    return Promise.all([connectionPromise, initExperimentPromise])
      .then(([run]) => {
        // Notify the FSM.
        this._fsm.runloaded(run);
      })
      .catch((e) => {
        this._catchError(e);
      });
  }

  async _onBlockLoading() {
    this._waitView.show();
    try {
      const block = await Promise.resolve(this._connection.getCurrentBlock()).catch((e) => {
        throw errorWithHeader(e, 'Could not retrieve current block info');
      });
      if (block) {
        this._fsm.blockloaded(
          Object.assign({}, block, { subjectiveAssessment: this._subjectiveAssessment })
        );
      } else {
        this._fsm.xpend();
      }
    } catch (e) {
      this._catchError(e);
    }
  }

  _onLeaveBlockLoading() {
    this._waitView.hide();
  }

  async _onBlockInit(name, from, to, blockInfo) {
    if (this._taskManager.newBlock) this._taskManager.newBlock(blockInfo);
    await this._blockInitView.show(blockInfo);
    this._fsm.startblock();
  }

  async _onTrialLoading() {
    this._waitView.show();
    const [trial] = await Promise.all([
      this._connection.getCurrentTrial(),
      // Make sure there is no more that queueSize pending post request before starting the trial.
      this._connection.flush(this._queueSize)
    ]);
    if (trial) this._fsm.trialloaded(trial);
    else this._fsm.xpend();
  }

  _onLeavetrialloading() {
    this._waitView.hide();
  }

  async _onTrialRunning(name, from, to, trial) {
    this._currentTrial = trial;

    try {
      // Run the trial.
      const results = await this._taskManager.startTrial(trial);

      // Post the results.
      this._connection.endCurrentTrial(results).catch((e) => {
        this._catchError(errorWithHeader(e, 'Could not register trial log'));
      });

      // Send the FSM events without waiting for the end of the post.
      if (trial.number < trial.block.trials.length - 1) {
        this._fsm.trialend();
      } else {
        this._fsm.blockend();
      }
    } catch (e) {
      this._catchError(errorWithHeader(e, 'Trial error'));
    }
  }

  async _onCompleted() {
    this._waitView.show();
    // Make sure everything that needs to be sent is sent.
    await this._connection.flush(0);
    // Disconnect the run.
    await this._connection.disconnect();
    this._waitView.hide();
    // Clear the local storage so that next time, a new run will be requested.
    localStorage.clear();
    // TODO: Well... Use a template?
    this._mainDiv.innerHTML =
      '<div style="text-align:center"><h1>THE END</h1> Thank you for your participation.</div>';
  }

  _catchError(error) {
    const message =
      error &&
      (error.message ||
        error.statusText ||
        (error.responseJSON && error.responseJSON.message) ||
        error);
    if (error instanceof Error) {
      console.error(error);
    }
    this._fsm.connecterror({ message, error });
  }

  _onCrashed(name, from, to, { message, error }) {
    if (this._taskManager.cancel) {
      this._taskManager.cancel(message);
    }
    this._waitView.hide();
    let run;
    try {
      run = this._connection.getRun();
    } finally {
      this._crashView.show(run, message, error);
    }
  }

  _getFsmCallbacks() {
    return Object.getOwnPropertyNames(Object.getPrototypeOf(this)).reduce((callbacks, prop) => {
      if (prop.startsWith('_on')) {
        const method = this[prop];
        if (typeof method === 'function') {
          return Object.assign(
            {
              [prop.toLowerCase().slice(1)]: method.bind(this)
            },
            callbacks
          );
        }
      }
      return callbacks;
    }, {});
  }

  get started() {
    return this.state !== 'idle';
  }

  get completed() {
    return this.state === 'completed';
  }

  get state() {
    return this._fsm.current;
  }
}
