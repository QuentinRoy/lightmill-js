import test from 'ava';
import { spy } from 'sinon';
import wait from 'wait-then';
import range from 'array-range';
import deferred from 'promise.defer';
import { runTrials } from '../run-experiment';

const makeTrialList = (blockCount = 2, trialCountPerBlock = 3) =>
  range(blockCount).reduce((acc, blockNumber) => {
    const block = { number: blockNumber };
    return [
      ...acc,
      ...range(trialCountPerBlock).map(number => ({ number, block }))
    ];
  }, []);

// Create a group of delayed spies, each spies create from this group is given a type
// and all spy calls can be monitored (in order) with may `all` spy.
// Also, all spies return a promise that resolves asynchronously. The resolution of the promise
// can be monitored as well.
const createDelayedSpiesGroup = () => {
  const all = spy();
  const createSpy = (type, f, done = '* ') =>
    spy((...args) => {
      all(type, args);
      return wait().then(f && (() => f(...args))).then(res => {
        if (done) all(done + type, res);
        return res;
      });
    });
  return { all, spy: createSpy };
};

test('`runTrials` works as expected when init block is provided', async t => {
  // Will register every spy call as { type, args }
  const spyGroup = createDelayedSpiesGroup();
  // Connection fake implementation.
  const trials = makeTrialList(2, 2);
  const connection = {
    postResults: spyGroup.spy('postResults', null, false),
    endTrial: spyGroup.spy('endTrial', () => trials.shift()),
    getCurrentTrial: spyGroup.spy('getCurrentTrial', () => trials.shift()),
    flush: spyGroup.spy('flush')
  };
  // App fake implementation,
  const app = {
    initBlock: spyGroup.spy('initBlock'),
    runTrial: spyGroup.spy('runTrial', trial => ({
      val: `${trial.block.number}-${trial.number}`
    }))
  };
  // Run the trials.
  await runTrials(connection, app, 7);
  // Expected calls on connection and app methods.
  const expectedCalls = [
    // block 1 trial 1
    ['getCurrentTrial', []],
    ['* getCurrentTrial', { number: 0, block: { number: 0 } }],
    ['initBlock', [{ number: 0 }]],
    ['* initBlock', undefined],
    ['flush', [7]],
    ['* flush', undefined],
    ['runTrial', [{ number: 0, block: { number: 0 } }]],
    ['* runTrial', { val: '0-0' }],
    ['postResults', [{ val: '0-0' }]],
    ['endTrial', []],
    ['* endTrial', { number: 1, block: { number: 0 } }],
    // block 1 trial 2
    ['flush', [7]],
    ['* flush', undefined],
    ['runTrial', [{ number: 1, block: { number: 0 } }]],
    ['* runTrial', { val: '0-1' }],
    ['postResults', [{ val: '0-1' }]],
    ['endTrial', []],
    ['* endTrial', { number: 0, block: { number: 1 } }],
    // block 2 trial 1
    ['initBlock', [{ number: 1 }]],
    ['* initBlock', undefined],
    ['flush', [7]],
    ['* flush', undefined],
    ['runTrial', [{ number: 0, block: { number: 1 } }]],
    ['* runTrial', { val: '1-0' }],
    ['postResults', [{ val: '1-0' }]],
    ['endTrial', []],
    ['* endTrial', { number: 1, block: { number: 1 } }],
    // block 2 trial 2
    ['flush', [7]],
    ['* flush', undefined],
    ['runTrial', [{ number: 1, block: { number: 1 } }]],
    ['* runTrial', { val: '1-1' }],
    ['postResults', [{ val: '1-1' }]],
    ['endTrial', []],
    ['* endTrial', undefined],
    // End
    ['flush', []],
    ['* flush', undefined]
  ];
  // Loop because that is easier to debug.
  expectedCalls.forEach((arg, i) => {
    t.deepEqual(arg, spyGroup.all.args[i], `Call ${i + 1} was as expected.`);
  });
  t.is(
    expectedCalls.length,
    spyGroup.all.callCount,
    'There was no extra calls.'
  );
});

test('`runTrials` works as expected when init block is not provided', async t => {
  const spyGroup = createDelayedSpiesGroup();
  // Connection fake implementation.
  const trials = makeTrialList(2, 1);
  const connection = {
    postResults: spyGroup.spy('postResults', null, false),
    endTrial: spyGroup.spy('endTrial', () => trials.shift()),
    getCurrentTrial: spyGroup.spy('getCurrentTrial', () => trials.shift()),
    flush: spyGroup.spy('flush')
  };
  // App fake implementation,
  const app = {
    runTrial: spyGroup.spy('runTrial', trial => ({
      result: `${trial.block.number}-${trial.number}`
    }))
  };
  // Run the trials.
  await runTrials(connection, app, 7);
  // Expected calls on connection and app methods.
  const expectedCalls = [
    // block 1 trial 1
    ['getCurrentTrial', []],
    ['* getCurrentTrial', { number: 0, block: { number: 0 } }],
    ['flush', [7]],
    ['* flush', undefined],
    ['runTrial', [{ number: 0, block: { number: 0 } }]],
    ['* runTrial', { result: '0-0' }],
    ['postResults', [{ result: '0-0' }]],
    ['endTrial', []],
    ['* endTrial', { number: 0, block: { number: 1 } }],
    // block 2 trial 1
    ['flush', [7]],
    ['* flush', undefined],
    ['runTrial', [{ number: 0, block: { number: 1 } }]],
    ['* runTrial', { result: '1-0' }],
    ['postResults', [{ result: '1-0' }]],
    ['endTrial', []],
    ['* endTrial', undefined],
    // End
    ['flush', []],
    ['* flush', undefined]
  ];
  // Loop because that is easier to debug.
  expectedCalls.forEach((arg, i) => {
    t.deepEqual(arg, spyGroup.all.args[i], `Call ${i + 1} was as expected.`);
  });
  t.is(
    spyGroup.all.callCount,
    expectedCalls.length,
    'There was no extra calls.'
  );
});

test('`runTrials` does not wait for post results before starting new trials', async t => {
  const postDefers = range(3).map(() => deferred());
  const postPromises = postDefers.map(def => def.promise);
  const trials = makeTrialList(1, 3);
  const connection = {
    postResults: spy(() => Promise.resolve(postPromises.shift())),
    endTrial: spy(() => Promise.resolve(trials.shift())),
    getCurrentTrial: spy(() => Promise.resolve(trials.shift())),
    flush: spy(() => Promise.resolve())
  };
  const app = { runTrial: spy(() => Promise.resolve({})) };
  runTrials(connection, app);
  await wait();
  t.deepEqual(
    app.runTrial.args,
    [
      [{ number: 0, block: { number: 0 } }],
      [{ number: 1, block: { number: 0 } }],
      [{ number: 2, block: { number: 0 } }]
    ],
    '`runTrial` have been called as expected'
  );
});

test('`runTrials` throws if a post fails during a trial', async t => {
  const postDefers = range(4).map(() => deferred());
  const postPromises = postDefers.map(def => def.promise);
  const trialDefers = range(4).map(() => deferred());
  const trialPromises = trialDefers.map(def => def.promise);
  const trials = makeTrialList(1, 4);
  const connection = {
    postResults: spy(() => postPromises.shift()),
    endTrial: spy(() => Promise.resolve(trials.shift())),
    getCurrentTrial: spy(() => Promise.resolve(trials.shift())),
    flush: spy(() => Promise.resolve())
  };
  const app = { runTrial: spy(() => trialPromises.shift()) };
  const prom = runTrials(connection, app);
  trialDefers[0].resolve({ res: 1 });
  trialDefers[1].resolve({ res: 2 });
  postDefers[0].resolve();
  postDefers[1].reject(new Error('test error'));
  await t.throws(
    prom,
    'Could not post trial results: test error',
    '`runTrials` threw'
  );
  t.deepEqual(
    connection.postResults.args,
    [[{ res: 1 }], [{ res: 2 }]],
    '`postResults` have been called as expected'
  );
  t.is(
    connection.endTrial.callCount,
    2,
    '`endTrial` have been called as expected'
  );
  t.deepEqual(
    app.runTrial.args,
    [
      [{ number: 0, block: { number: 0 } }],
      [{ number: 1, block: { number: 0 } }],
      [{ number: 2, block: { number: 0 } }]
    ],
    '`runTrial` have been called as expected'
  );
});

test('`runTrials` throws if a post fails even if all trials are done', async t => {
  const postDefers = range(4).map(() => deferred());
  const postPromises = postDefers.map(def => def.promise);
  const trialPromises = range(4).map(i => Promise.resolve({ res: i + 1 }));
  const trials = makeTrialList(1, 4);
  const connection = {
    postResults: spy(() => postPromises.shift()),
    endTrial: spy(() => Promise.resolve(trials.shift())),
    getCurrentTrial: spy(() => Promise.resolve(trials.shift())),
    flush: spy(
      () =>
        trialPromises.length > 0 ? Promise.resolve() : new Promise(() => {})
    )
  };
  const app = { runTrial: spy(() => trialPromises.shift()) };
  const prom = runTrials(connection, app);
  (async () => {
    await wait();
    postDefers[0].resolve();
    await wait();
    postDefers[1].resolve();
    await wait();
    postDefers[2].reject(new Error('test error'));
  })();
  await t.throws(
    prom,
    'Could not post trial results: test error',
    '`runTrials` threw'
  );
  t.deepEqual(
    connection.postResults.args,
    [[{ res: 1 }], [{ res: 2 }], [{ res: 3 }], [{ res: 4 }]],
    '`postResults` have been called as expected'
  );
  t.is(
    connection.endTrial.callCount,
    4,
    '`endTrial` have been called as expected'
  );
  t.deepEqual(
    app.runTrial.args,
    [
      [{ number: 0, block: { number: 0 } }],
      [{ number: 1, block: { number: 0 } }],
      [{ number: 2, block: { number: 0 } }],
      [{ number: 3, block: { number: 0 } }]
    ],
    '`runTrial` have been called as expected'
  );
});
