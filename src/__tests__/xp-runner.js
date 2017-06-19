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
  const createSubSpy = (type, f) =>
    spy((...args) => {
      mainSpy({ type, args });
      return wait().then(f && (() => f(...args)));
    });
  // Connection fake implementation.
  const trials = makeTrialList(2, 2);
  const connection = {
    endCurrentTrial: createSubSpy('endCurrentTrial'),
    getCurrentTrial: createSubSpy('getCurrentTrial', () => trials.shift()),
    flush: createSubSpy('flush')
  };
  // App fake implementation.
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
    [{ type: 'getCurrentTrial', args: [] }],
    [{ type: 'initBlock', args: [{ number: 0 }] }],
    [{ type: 'flush', args: [7] }],
    [{ type: 'runTrial', args: [{ number: 0, block: { number: 0 } }] }],
    [{ type: 'endCurrentTrial', args: [{ val: '0-0' }] }],
    // block 1 trial 2
    [{ type: 'getCurrentTrial', args: [] }],
    [{ type: 'flush', args: [7] }],
    [{ type: 'runTrial', args: [{ number: 1, block: { number: 0 } }] }],
    [{ type: 'endCurrentTrial', args: [{ val: '0-1' }] }],
    // block 2 trial 1
    [{ type: 'getCurrentTrial', args: [] }],
    [{ type: 'initBlock', args: [{ number: 1 }] }],
    [{ type: 'flush', args: [7] }],
    [{ type: 'runTrial', args: [{ number: 0, block: { number: 1 } }] }],
    [{ type: 'endCurrentTrial', args: [{ val: '1-0' }] }],
    // block 2 trial 2
    [{ type: 'getCurrentTrial', args: [] }],
    [{ type: 'flush', args: [7] }],
    [{ type: 'runTrial', args: [{ number: 1, block: { number: 1 } }] }],
    [{ type: 'endCurrentTrial', args: [{ val: '1-1' }] }],
    // End
    [{ type: 'getCurrentTrial', args: [] }],
    [{ type: 'flush', args: [] }]
  ];
  // Loop because that is easier to debug.
  expectedCalls.forEach((arg, i) => {
    t.deepEqual(arg, mainSpy.args[i], `Call ${i + 1} was as expected.`);
  });
  t.is(expectedCalls.length, mainSpy.args.length, 'There was no extra calls.');
});
