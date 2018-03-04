import wait from 'wait-then';
import runTrials from '../run-trials';
import runExperiment from '../run-experiment';

jest.mock('../run-trials');

// Create a group of delayed spies, each spies create from this group is given
// a type and all spy calls can be monitored (in order) with the `all` spy.
// Also, all spies return a promise that resolves asynchronously. The resolution
// of the promise can be monitored as well (calls all with the prefix *).
const createDelayedSpiesGroup = () => {
  // Create the main spy, registering all spies call and spies return promise
  // resolutions.
  const all = jest.fn().mockName('spyGroup#all');
  // A function to add a new spy to the spy group.
  const createSpy = (
    type,
    f,
    { delay = 0, done = delay || delay === 0 } = {}
  ) =>
    jest.fn((...args) => {
      // Register the call.
      all(type, args);

      // Define the result.
      let res;
      if (!delay && delay !== 0) {
        res = typeof f === 'function' ? f(...args) : f;
      } else {
        res = wait(delay).then(
          () => (typeof f === 'function' ? f(...args) : f)
        );
      }

      // Register the result of the promise.
      if (done) {
        res = res.then(
          res_ => {
            all(`${type} resolution`, res_);
            return res_;
          },
          err => {
            all(`${type} rejection`, err);
            throw err;
          }
        );
      }
      return res;
    });
  return { all, spy: createSpy };
};

afterEach(() => {
  jest.resetAllMocks();
});

describe('runExperiment', () => {
  it('runs as expected if every app handlers are provided', async () => {
    const spyGroup = createDelayedSpiesGroup();

    runTrials.mockImplementation(spyGroup.spy('runTrials'));

    // Connection fake implementation.
    const connection = {
      mockName: 'connection',
      // app.start and get run are supposed to be called in parallel. The delay
      // forces be resolved after app.start.
      getRun: spyGroup.spy('connection.getRun', { id: 'runId' }, { delay: 2 }),
      disconnect: spyGroup.spy('connection.disconnect')
    };
    // App fake implementation.
    const app = {
      mockName: 'app',
      start: spyGroup.spy('app.start'),
      initBlock: spyGroup.spy('app.initBlock'),
      runTrial: spyGroup.spy('app.runTrial', trial => ({
        result: `${trial.block.number}-${trial.number}`
      })),
      end: spyGroup.spy('app.end', null, { delay: false })
    };
    // Storage fake implementation
    const runStorage = {
      mockName: 'runStorage',
      set: spyGroup.spy('storage.set', null, { delay: false }),
      remove: spyGroup.spy('storage.remove', null, { delay: false })
    };
    await runExperiment(app, {
      experimentId: 'xpId',
      runId: 'runId',
      connection,
      runStorage
    });
    expect(spyGroup.all).toMatchSnapshot();
  });

  it('works properly even if only `app.runTrial` is provided', async () => {
    const spyGroup = createDelayedSpiesGroup();

    runTrials.mockImplementation(spyGroup.spy('runTrials'));

    // Connection fake implementation.
    const connection = {
      mockName: 'connection',
      getRun: spyGroup.spy('connection.getRun', { id: 'runId' }),
      disconnect: spyGroup.spy('connection.disconnect')
    };

    // App fake implementation.
    const app = {
      mockName: 'app',
      runTrial: spyGroup.spy('app.runTrial', trial => ({
        result: `${trial.block.number}-${trial.number}`
      }))
    };

    // Storage fake implementation
    const runStorage = {
      mockName: 'runStorage',
      set: spyGroup.spy('storage.set', null, { delay: null }),
      remove: spyGroup.spy('storage.remove', null, { delay: null })
    };

    await runExperiment(app, {
      experimentId: 'xpId',
      runId: 'runId',
      connection,
      runStorage
    });

    expect(spyGroup.all).toMatchSnapshot();
  });

  it('calls `app.crash` then throws if runTrials goes wrong', async () => {
    const spyGroup = createDelayedSpiesGroup();

    runTrials.mockImplementation(
      spyGroup.spy('runTrials', () =>
        Promise.reject(new Error('runTrials error'))
      )
    );

    // Connection fake implementation.
    const connection = {
      mockName: 'connection',
      getRun: spyGroup.spy('connection.getRun', { id: 'runId' }),
      disconnect: spyGroup.spy('connection.disconnect')
    };

    // App fake implementation.
    const app = {
      mockName: 'app',
      runTrial: spyGroup.spy('app.runTrial', trial => ({
        result: `${trial.block.number}-${trial.number}`
      }))
    };

    // Storage fake implementation
    const runStorage = {
      mockName: 'runStorage',
      set: spyGroup.spy('storage.set', null, { delay: null }),
      remove: spyGroup.spy('storage.remove', null, { delay: null })
    };

    // Run the experiment.
    await expect(
      runExperiment(app, {
        experimentId: 'xpId',
        runId: 'runId',
        connection,
        runStorage
      })
    ).rejects.toThrow('runTrials error');

    expect(spyGroup.all).toMatchSnapshot();
  });

  it('calls app.crash then throws for any possible things that can go wrong.');

  it('creates a RunInterface using stored run id if none are provided');
});
