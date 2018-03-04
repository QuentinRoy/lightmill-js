import test from 'ava';
import { spy } from 'sinon';
import wait from 'wait-then';
import range from 'array-range';
import deferred from 'promise.defer';
import runExperiment from '../run-experiment';

const makeTrialList = (blockCount = 2, trialCountPerBlock = 3) =>
  range(blockCount).reduce((acc, blockNumber) => {
    const block = { number: blockNumber };
    return [
      ...acc,
      ...range(trialCountPerBlock).map(number => ({ number, block }))
    ];
  }, []);

// Create a group of delayed spies, each spies create from this group is given
// a type and all spy calls can be monitored (in order) with may `all` spy.
// Also, all spies return a promise that resolves asynchronously. The resolution
// of the promise can be monitored as well.
const createDelayedSpiesGroup = () => {
  const all = spy();
  const createSpy = (
    type,
    f,
    { delay = 0, done = delay || delay === 0 } = {}
  ) =>
    spy((...args) => {
      all(type, args);
      let res;
      if (!delay && delay !== 0) {
        res = typeof f === 'function' ? f(...args) : f;
      } else {
        res = wait(delay).then(
          () => (typeof f === 'function' ? f(...args) : f)
        );
      }
      if (done) {
        res = res.then(
          res_ => {
            all(`* ${type}`, res_);
            return res_;
          },
          err => {
            all(`X ${type}`, err);
            throw err;
          }
        );
      }
      return res;
    });
  return { all, spy: createSpy };
};

test('`runExperiment` runs as expected if every app handlers are provided', async t => {
  const spyGroup = createDelayedSpiesGroup();
  // Connection fake implementation.
  const trials = makeTrialList(2, 2);
  const connection = {
    disconnect: spyGroup.spy('connection.disconnect'),
    postResults: spyGroup.spy('connection.postResults', null, { done: false }),
    endTrial: spyGroup.spy('connection.endTrial', () => trials.shift()),
    getCurrentTrial: spyGroup.spy('connection.getCurrentTrial', () =>
      trials.shift()
    ),
    flush: spyGroup.spy('connection.flush'),
    getRun: spyGroup.spy('connection.getRun', { id: 'runId' })
  };
  // App fake implementation.
  const app = {
    start: spyGroup.spy('app.start', null, { done: null }),
    initBlock: spyGroup.spy('app.initBlock'),
    runTrial: spyGroup.spy('app.runTrial', trial => ({
      result: `${trial.block.number}-${trial.number}`
    })),
    end: spyGroup.spy('app.end', null, { delay: null })
  };
  // Storage fake implementation
  const runStorage = {
    set: spyGroup.spy('storage.set', null, { delay: null }),
    remove: spyGroup.spy('storage.remove', null, { delay: null })
  };
  await runExperiment(app, {
    experimentId: 'xpId',
    runId: 'runId',
    connection,
    runStorage
  });
  t.snapshot(spyGroup.all.args);
});

test('`runExperiment` works properly even if only `app.runTrial` is provided', async t => {
  const spyGroup = createDelayedSpiesGroup();
  // Connection fake implementation.
  const trials = makeTrialList(2, 2);
  const connection = {
    disconnect: spyGroup.spy('connection.disconnect'),
    postResults: spyGroup.spy('connection.postResults', null, { done: false }),
    endTrial: spyGroup.spy('connection.endTrial', () => trials.shift()),
    getCurrentTrial: spyGroup.spy('connection.getCurrentTrial', () =>
      trials.shift()
    ),
    flush: spyGroup.spy('connection.flush'),
    getRun: spyGroup.spy('connection.getRun', { id: 'runId' })
  };
  // App fake implementation.
  const app = {
    runTrial: spyGroup.spy('app.runTrial', trial => ({
      result: `${trial.block.number}-${trial.number}`
    }))
  };
  // Storage fake implementation
  const runStorage = {
    set: spyGroup.spy('storage.set', null, { delay: null }),
    remove: spyGroup.spy('storage.remove', null, { delay: null })
  };
  await runExperiment(app, {
    experimentId: 'xpId',
    runId: 'runId',
    connection,
    runStorage
  });
  t.snapshot(spyGroup.all.args);
});

test('`runExperiment` calls `app.crash` then throws if a post goes wrong', async t => {
  const spyGroup = createDelayedSpiesGroup();
  const trials = makeTrialList(2, 2);
  // Deferred and promise lists for result posts.
  const postDefs = trials.map(() => deferred());
  const postProms = postDefs.map(def => def.promise);
  // Deferred and promise lists for trial results.
  const trialDefs = trials.map(() => deferred());
  const trialProms = trialDefs.map(def => def.promise);
  // Flush getters, defines the behavior of `connection.flush`.
  const flushGetters = [
    ...trials.map(() => () => Promise.resolve()),
    () => new Promise(() => {})
  ];
  // Connection fake implementation.
  const connection = {
    disconnect() {},
    postResults: spyGroup.spy('postResults', () => postProms.shift(), {
      delay: null,
      done: true
    }),
    endTrial: async () => trials.shift(),
    getCurrentTrial: async () => trials.shift(),
    flush: () => flushGetters.shift().call(),
    getRun: () => wait().then(() => ({ id: 'runId' }))
  };
  // App fake implementation.
  const app = {
    runTrial: spyGroup.spy('runTrial', () => trialProms.shift(), {
      delay: null,
      done: true
    }),
    crash: spyGroup.spy('crash')
  };
  // Run the experiment.
  const runP = t.throws(
    runExperiment(app, {
      experimentId: 'xpId',
      runId: 'runId',
      connection,
      runStorage: { set() {}, remove() {} }
    }),
    'Could not post trial results: reject test'
  );
  trialDefs[0].resolve();
  trialDefs[1].resolve();
  await wait(5);
  postDefs[0].resolve();
  postDefs[1].reject(new Error('reject test'));
  await runP;
  t.snapshot(spyGroup.all.args);
});

test('`runExperiment` calls `app.crash` then throws if a trial goes wrong', async t => {
  const spyGroup = createDelayedSpiesGroup();
  const trials = makeTrialList(2, 2);
  // Connection fake implementation.
  const connection = {
    disconnect() {},
    postResults: () => wait(),
    endTrial: async () => trials.shift(),
    getCurrentTrial: async () => trials.shift(),
    flush: () => wait(),
    async getRun() {
      await wait();
      return { id: 'runId' };
    }
  };
  // App fake implementation.
  const runTrialGetters = [
    () => Promise.resolve({ res: 1 }),
    () => Promise.resolve({ res: 2 }),
    () => Promise.reject(new Error('bad trial'))
  ];
  const app = {
    runTrial: spyGroup.spy('runTrial', () => runTrialGetters.shift().call()),
    crash: spyGroup.spy('crash')
  };
  // Run the experiment.
  await t.throws(
    runExperiment(app, {
      experimentId: 'xpId',
      runId: 'runId',
      connection,
      runStorage: { set() {}, remove() {} }
    }),
    'bad trial'
  );
  t.snapshot(spyGroup.all.args);
});

test('`runExperiment` calls `app.crash` then throws if a post goes wrong even if all trials are done', async t => {
  const spyGroup = createDelayedSpiesGroup();
  // Flat list of all trials.
  const trials = makeTrialList(2, 1);
  // Deferred and promise lists for result posts.
  const postDefs = trials.map(() => deferred());
  const posts = postDefs.map(def => def.promise);
  // Flush getters, defines the behavior of `connection.flush`.
  const flushGetters = [
    ...trials.map(() => () => wait()),
    () => new Promise(() => {})
  ];
  // Connection fake implementation.
  const connection = {
    disconnect() {},
    postResults: spyGroup.spy('postResults', () => posts.shift()),
    endTrial: async () => trials.shift(),
    getCurrentTrial: async () => trials.shift(),
    flush: () => flushGetters.shift().call(),
    getRun: () => wait().then(() => ({ id: 'runId' }))
  };
  // Resolved when all trials are done.
  const trialDone = deferred();
  // App fake implementation.
  const results = range(trials.length);
  const app = {
    runTrial: spyGroup.spy('runTrial', () => {
      const res = results.shift();
      if (results.length === 0) trialDone.resolve();
      return { res };
    }),
    crash: spyGroup.spy('crash')
  };
  // Run the experiment.
  const runP = t.throws(
    runExperiment(app, {
      experimentId: 'xpId',
      runId: 'runId',
      connection,
      queueSize: 5,
      runStorage: { set() {}, remove() {} }
    }),
    'Could not post trial results: reject test',
    '`runExperiment` threw.'
  );
  await trialDone.promise;
  // Resolve one posts.
  postDefs[0].resolve();
  postDefs[1].reject(new Error('reject test'));

  await runP;

  t.snapshot(spyGroup.all.args);
});

test.todo(
  '`runExperiment` calls `app.crash` then throws for any possible things that can go wrong.'
);

test.todo(
  '`runExperiment` creates a RunInterface using stored run id if none are provided'
);
