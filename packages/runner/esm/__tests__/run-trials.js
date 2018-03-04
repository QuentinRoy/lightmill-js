import test from 'ava';
import { spy } from 'sinon';
import wait from 'wait-then';
import range from 'array-range';
import deferred from 'promise.defer';
import runTrials from '../run-trials';

const makeTrialList = (blockCount = 2, trialCountPerBlock = 3) =>
  range(blockCount).reduce((acc, blockNumber) => {
    const block = { number: blockNumber };
    return [
      ...acc,
      ...range(trialCountPerBlock).map(number => ({ number, block }))
    ];
  }, []);

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
