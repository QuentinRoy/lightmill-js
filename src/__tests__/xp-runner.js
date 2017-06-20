import test from 'ava';
import { spy } from 'sinon';
import wait from 'wait-then';
import range from 'array-range';
import { runTrials } from '../xp-runner';

const makeTrialList = (blockCount = 2, trialCountPerBlock = 3) =>
  range(blockCount).reduce((acc, blockNumber) => {
    const block = { number: blockNumber };
    return [
      ...acc,
      ...range(trialCountPerBlock).map(number => ({ number, block }))
    ];
  }, []);

test('runTrials works as expected', async t => {
  // Will register every spy call as { type, args }
  const mainSpy = spy();
  // Create a sub spy with the provided type.
  const createSubSpy = (type, f, done = true) =>
    spy((...args) => {
      mainSpy(type, args);
      return wait().then(f && (() => f(...args))).then(r => {
        if (done) mainSpy(`* ${type}`);
        return r;
      });
    });
  // Connection fake implementation.
  const trials = makeTrialList(2, 2);
  const connection = {
    endCurrentTrial: createSubSpy('endCurrentTrial', null, false),
    getCurrentTrial: createSubSpy('getCurrentTrial', () => trials.shift()),
    flush: createSubSpy('flush')
  };
  // App fake implementation,
  const app = {
    initBlock: createSubSpy('initBlock'),
    runTrial: createSubSpy('runTrial', trial => ({
      val: `${trial.block.number}-${trial.number}`
    }))
  };
  // Run the trials.
  await runTrials(connection, app, 7);
  // Expected calls on connection and app methods.
  const expectedCalls = [
    // block 1 trial 1
    ['getCurrentTrial', []],
    ['* getCurrentTrial'],
    ['initBlock', [{ number: 0 }]],
    ['* initBlock'],
    ['flush', [7]],
    ['* flush'],
    ['runTrial', [{ number: 0, block: { number: 0 } }]],
    ['* runTrial'],
    ['endCurrentTrial', [{ val: '0-0' }]],
    // block 1 trial 2
    ['getCurrentTrial', []],
    ['* getCurrentTrial'],
    ['flush', [7]],
    ['* flush'],
    ['runTrial', [{ number: 1, block: { number: 0 } }]],
    ['* runTrial'],
    ['endCurrentTrial', [{ val: '0-1' }]],
    // block 2 trial 1
    ['getCurrentTrial', []],
    ['* getCurrentTrial'],
    ['initBlock', [{ number: 1 }]],
    ['* initBlock'],
    ['flush', [7]],
    ['* flush'],
    ['runTrial', [{ number: 0, block: { number: 1 } }]],
    ['* runTrial'],
    ['endCurrentTrial', [{ val: '1-0' }]],
    // block 2 trial 2
    ['getCurrentTrial', []],
    ['* getCurrentTrial'],
    ['flush', [7]],
    ['* flush'],
    ['runTrial', [{ number: 1, block: { number: 1 } }]],
    ['* runTrial'],
    ['endCurrentTrial', [{ val: '1-1' }]],
    // End
    ['getCurrentTrial', []],
    ['* getCurrentTrial'],
    ['flush', []],
    ['* flush']
  ];
  // Loop because that is easier to debug.
  expectedCalls.forEach((arg, i) => {
    t.deepEqual(arg, mainSpy.args[i], `Call ${i + 1} was as expected.`);
  });
  t.is(expectedCalls.length, mainSpy.args.length, 'There was no extra calls.');
});
