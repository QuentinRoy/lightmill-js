import test from 'ava';
import { spy, stub } from 'sinon';
import wait from 'wait-then';
import deferred from 'promise.defer';
import RunConnection, {
  isExperimentLoadedOnServer,
  connectToRun,
  selectRun,
  consolidateRun
} from '../run-connection';

const spyDelay = (result, delay = 10) =>
  spy(() => wait(delay).then(() => result));

test('`isExperimentLoadedOnServer` checks if the experiment is available on the server', async t => {
  const server = {
    experiments: spyDelay({ xp1: {}, xp2: {} })
  };
  t.true(await isExperimentLoadedOnServer(server, 'xp1'));
  t.is(server.experiments.callCount, 1);
  t.false(await isExperimentLoadedOnServer(server, 'nothere'));
  t.is(server.experiments.callCount, 2);
});

test('`selectRun` ask for an available run if no run is provided', async t => {
  const server = { availableRun: spyDelay({ experimentId: 'xpid' }) };
  t.deepEqual(await selectRun(server, 'xpid'), { experimentId: 'xpid' });
  t.true(server.availableRun.calledWithExactly('xpid'));
  t.is(server.availableRun.callCount, 1);
});

test('`selectRun` ask for the specified run if it is provided', async t => {
  const server = { run: spyDelay({ experimentId: 'xpid', id: 'runid' }) };
  t.deepEqual(await selectRun(server, 'xpid', 'runid'), {
    experimentId: 'xpid',
    id: 'runid'
  });
  t.true(server.run.calledWithExactly('xpid', 'runid'));
  t.is(server.run.callCount, 1);
});

test('`selectRun` throws if the received ids are consistant with what has been asked', async t => {
  const server = {
    availableRun: spyDelay({ id: 'runid', experimentId: 'xpid' }),
    run: spyDelay({ id: 'runid', experimentId: 'xpid' })
  };
  await t.throws(selectRun(server, 'otherxpid'));
  await t.throws(selectRun(server, 'xpid', 'otherrunid'));
});

test("`connectToRun` properly locks, ask for run's plan and for run's current trial when no run is specified", async t => {
  const server = {
    lock: spyDelay({ token: 'lock' }),
    plan: spyDelay(['block1', 'block2']),
    currentTrial: spyDelay({ number: 5, blockNumber: 10 })
  };
  const result = await connectToRun(server, {
    id: 'runid',
    experimentId: 'xpid'
  });
  t.deepEqual(server.lock.args, [['xpid', 'runid']]);
  t.deepEqual(server.plan.args, [['xpid', 'runid']]);
  t.deepEqual(server.currentTrial.args, [['xpid', 'runid']]);
  t.deepEqual(result, {
    id: 'runid',
    experimentId: 'xpid',
    blocks: ['block1', 'block2'],
    currentTrial: { number: 5, blockNumber: 10 },
    lock: { token: 'lock' }
  });
});

const makeRunPlan = () => ({
  id: 'runid',
  experimentId: 'xpid',
  blocks: [
    {
      values: { bval1: 'b11', bval2: 'b12' },
      number: 0,
      trials: [
        { values: { tval1: 't111', tval2: 't112' }, number: 0 },
        { values: { tval1: 't121', tval2: 't122' }, number: 1 }
      ]
    },
    {
      values: { bval1: 'b21', bval2: 'b22' },
      number: 1,
      trials: [
        { values: { tval1: 't211', tval2: 't212' }, number: 0 },
        { values: { tval1: 't221', tval2: 't222' }, number: 1 }
      ]
    }
  ]
});

test('`consolidateRun` properly inserts backrefs.', t => {
  t.plan(6);
  const run = consolidateRun(makeRunPlan());
  run.blocks.forEach(block => {
    t.is(block.run, run);
    block.trials.forEach(trial => {
      t.is(trial.block, block);
    });
  });
});

const makeRCon = ({
  run = consolidateRun(makeRunPlan()),
  token = '',
  trial = 0,
  block = 0,
  queue = {
    push: spyDelay(),
    flush: spyDelay()
  },
  post = spyDelay()
}) =>
  Object.assign({
    run,
    queue,
    post,
    rcon: new RunConnection(run, token, block, trial, queue, post)
  });

test('`RunConnection` properly finds the first trial', async t => {
  const { rcon, run } = makeRCon({ trial: 0, block: 1 });
  t.is(run.blocks[1].trials[0], await rcon.getCurrentTrial());
  t.is(await rcon.getCurrentBlock(), run.blocks[1]);
});

test('`RunConnection` properly finds the next trial when on the same block', async t => {
  const { rcon } = makeRCon({ trial: 0, block: 1 });
  const next = await rcon.getNextTrial();
  t.is(next.number, 1);
  t.is(next.block.number, 1);
});

test('`RunConnection` properly finds the next trial when on the next block', async t => {
  const { rcon } = makeRCon({ trial: 1, block: 0 });
  const next = await rcon.getNextTrial();
  t.is(next.number, 0);
  t.is(next.block.number, 1);
});

test('`RunConnection.getNextTrial` resolved undefined when on the last trial', async t => {
  const { rcon } = makeRCon({ trial: 1, block: 1 });
  t.is(await rcon.getNextTrial(), undefined);
});

test('`RunConnection.endCurrentTrial` properly switches to the next trial', async t => {
  const { rcon } = makeRCon({ trial: 0, block: 1 });
  const currentTrial = await rcon.getCurrentTrial();
  const nextTrial = await rcon.getNextTrial();
  t.is(currentTrial.number, 0);
  t.is(currentTrial.block.number, 1);
  t.is(nextTrial.number, 1);
  t.is(nextTrial.block.number, 1);
  await rcon.endCurrentTrial({});
  t.is(await rcon.getCurrentTrial(), nextTrial);
});

test('`RunConnection` properly posts the measures on endCurrentTrial', async t => {
  const { rcon, post } = makeRCon({ trial: 0, block: 0, token: 'token' });
  await rcon.endCurrentTrial({ val: 'val' });
  t.deepEqual(post.args, [
    ['xpid', 'runid', 0, 0, { token: 'token', measures: { val: 'val' } }]
  ]);
});

test('`RunConnection` posts the results sequentially', async t => {
  const defs = Array.from({ length: 3 }).map(() => deferred());
  const post = stub();
  defs.forEach((def, i) => post.onCall(i).returns(def.promise));
  const { rcon } = makeRCon({ trial: 0, block: 0, post, token: 'token' });
  await rcon.endCurrentTrial({ val: 'val1' });
  await rcon.endCurrentTrial({ val: 'val2' });
  await rcon.endCurrentTrial({ val: 'val3' });
  // Only one call for now as no post as returned yet.
  t.deepEqual(post.args, [
    ['xpid', 'runid', 0, 0, { token: 'token', measures: { val: 'val1' } }]
  ]);
  defs[0].resolve();
  await wait();
  // Second call call now.
  t.deepEqual(post.args, [
    ['xpid', 'runid', 0, 0, { token: 'token', measures: { val: 'val1' } }],
    ['xpid', 'runid', 0, 1, { token: 'token', measures: { val: 'val2' } }]
  ]);
  defs[1].resolve();
  await wait();
  // Third call call now.
  t.deepEqual(post.args, [
    ['xpid', 'runid', 0, 0, { token: 'token', measures: { val: 'val1' } }],
    ['xpid', 'runid', 0, 1, { token: 'token', measures: { val: 'val2' } }],
    ['xpid', 'runid', 1, 0, { token: 'token', measures: { val: 'val3' } }]
  ]);
});

test("`RunConnection`'s posts resolve as expected", async t => {
  const defs = Array.from({ length: 3 }).map(() => deferred());
  const post = stub();
  defs.forEach((def, i) => post.onCall(i).returns(def.promise));
  const { rcon, queue } = makeRCon({ post });
  await rcon.endCurrentTrial({ val: 'val1' });
  await rcon.endCurrentTrial({ val: 'val2' });
  await rcon.endCurrentTrial({ val: 'val3' });
  const postResolutions = new Array(queue.push.args.length).fill(false);
  queue.push.args.forEach(([promise], i) =>
    promise.then(() => {
      postResolutions[i] = true;
    })
  );
  t.deepEqual(postResolutions, [false, false, false]);
  defs[0].resolve();
  await wait();
  t.deepEqual(postResolutions, [true, false, false]);
  // In theory this has no effect since the corresponding promise should not have been fetched
  // yet.
  defs[2].resolve();
  await wait();
  t.deepEqual(postResolutions, [true, false, false]);
  defs[1].resolve();
  await wait();
  t.deepEqual(postResolutions, [true, true, true]);
});

test('`RunConnection.flush` is delegated on the queue', async t => {
  const def = deferred();
  const queue = {
    push: spyDelay(),
    flush: spy(() => def.promise)
  };
  const { rcon } = makeRCon({ queue });
  let resolved = false;
  rcon.flush(42).then(() => {
    resolved = true;
  });
  t.deepEqual(queue.flush.args, [[42]]);
  await wait();
  t.false(resolved);
  def.resolve();
  await wait();
  t.true(resolved);
});
