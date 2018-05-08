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

describe('runTrials', () => {
  it('does not wait for post results before starting new trials', async () => {
    const postDefers = range(3).map(() => deferred());
    const postPromises = postDefers.map(def => def.promise);
    const trials = makeTrialList(1, 3);
    const connection = {
      postResults: jest.fn(() => Promise.resolve(postPromises.shift())),
      endTrial: jest.fn(() => Promise.resolve(trials.shift())),
      getCurrentTrial: jest.fn(() => Promise.resolve(trials.shift())),
      flush: jest.fn(() => Promise.resolve())
    };
    const app = { runTrial: jest.fn(() => Promise.resolve({})) };
    runTrials(connection, app);
    await wait(0);
    expect(app.runTrial.mock.calls).toEqual([
      [{ number: 0, block: { number: 0 } }],
      [{ number: 1, block: { number: 0 } }],
      [{ number: 2, block: { number: 0 } }]
    ]);
  });

  it('throws if a post fails during a trial', async () => {
    const postDefers = range(4).map(() => deferred());
    const postPromises = postDefers.map(def => def.promise);
    const trialDefers = range(4).map(() => deferred());
    const trialPromises = trialDefers.map(def => def.promise);
    const trials = makeTrialList(1, 4);
    const connection = {
      postResults: jest.fn(() => postPromises.shift()),
      endTrial: jest.fn(() => Promise.resolve(trials.shift())),
      getCurrentTrial: jest.fn(() => Promise.resolve(trials.shift())),
      flush: jest.fn(() => Promise.resolve())
    };
    const app = { runTrial: jest.fn(() => trialPromises.shift()) };
    const prom = runTrials(connection, app);
    trialDefers[0].resolve({ res: 1 });
    postDefers[0].resolve();
    trialDefers[1].resolve({ res: 2 });
    // We wait before rejecting to leave opportunity for the next trial to start
    // before the rejection.
    await wait();
    postDefers[1].reject(new Error('test error'));
    await expect(prom).rejects.toThrow(
      'Could not post trial results: test error'
    );
    expect(connection.postResults.mock.calls).toEqual([
      [{ res: 1 }],
      [{ res: 2 }]
    ]);
    expect(connection.endTrial).toHaveBeenCalledTimes(2);
    expect(app.runTrial.mock.calls).toEqual([
      [{ number: 0, block: { number: 0 } }],
      [{ number: 1, block: { number: 0 } }],
      [{ number: 2, block: { number: 0 } }]
    ]);
  });

  it('throws if a post fails even if all trials are done', async () => {
    const postDefers = range(4).map(() => deferred());
    const postPromises = postDefers.map(def => def.promise);
    const trialPromises = range(4).map(i => Promise.resolve({ res: i + 1 }));
    const trials = makeTrialList(1, 4);
    const connection = {
      postResults: jest.fn(() => postPromises.shift()),
      endTrial: jest.fn(() => Promise.resolve(trials.shift())),
      getCurrentTrial: jest.fn(() => Promise.resolve(trials.shift())),
      flush: jest.fn(
        () =>
          trialPromises.length > 0 ? Promise.resolve() : new Promise(() => {})
      )
    };
    const app = { runTrial: jest.fn(() => trialPromises.shift()) };
    const prom = runTrials(connection, app);
    (async () => {
      await wait(0);
      postDefers[0].resolve();
      await wait(0);
      postDefers[1].resolve();
      await wait(0);
      postDefers[2].reject(new Error('test error'));
    })();
    await expect(prom).rejects.toThrow(
      'Could not post trial results: test error'
    );
    expect(connection.postResults.mock.calls).toEqual([
      [{ res: 1 }],
      [{ res: 2 }],
      [{ res: 3 }],
      [{ res: 4 }]
    ]);
    expect(connection.endTrial).toHaveBeenCalledTimes(4);
    expect(app.runTrial.mock.calls).toEqual([
      [{ number: 0, block: { number: 0 } }],
      [{ number: 1, block: { number: 0 } }],
      [{ number: 2, block: { number: 0 } }],
      [{ number: 3, block: { number: 0 } }]
    ]);
  });
});
