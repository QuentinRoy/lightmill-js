import test from 'ava';
import { spy } from 'sinon';
import wait from 'wait-then';
import range from 'array-range';
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
  t.is(expectedCalls.length, spyGroup.all.callCount, 'There was no extra calls.');
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
