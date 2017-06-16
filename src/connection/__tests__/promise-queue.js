/* eslint-disable import/no-extraneous-dependencies */
import test from 'ava';
import PromiseQueue from '../promise-queue';

const wait = (time = 0) => new Promise((resolve) => { setTimeout(resolve, time); });

const deferred = () => {
  let state = 'pending';
  const def = {
    get state() { return state; }
  };
  def.promise = new Promise((resolve, reject) => Object.assign(def, {
    async resolve() {
      state = 'resolved';
      resolve();
      await def.promise;
    },
    async reject() {
      state = 'rejected';
      reject();
      await def.promise;
    }
  }));
  return def;
};

test('PromiseQueue.queueLength reflects the number of unresolved promises that has been pushed', async (t) => {
  const queue = new PromiseQueue();
  const defs = new Array(5).fill(undefined).map(deferred);
  defs[2].resolve();
  queue.push(...defs.map(({ promise }) => promise));
  await defs[2].promise;
  t.is(queue.length, 4);
  await defs[4].resolve();
  t.is(queue.length, 3);
  await defs[0].resolve();
  t.is(queue.length, 2);
  await defs[1].resolve();
  t.is(queue.length, 1);
  await defs[3].resolve();
  t.is(queue.length, 0);
});

test('PromiseQueue.flush resolves if its queue length is smaller than the required flush', async (t) => {
  const queue = new PromiseQueue();
  await queue.flush(0);
  queue.push(new Promise(() => {}));
  queue.push(new Promise(() => {}));
  await queue.flush(2);
  t.pass('All promises resolved.');
});

test('PromiseQueue.flush resolves once the queue length fall below the provided length', async (t) => {
  const queue = new PromiseQueue();
  const defs = new Array(5).fill(undefined).map(deferred);
  const resolvedFlushes = [];
  queue.push(Promise.resolve(), ...defs.map(({ promise }) => promise), Promise.resolve());
  [1, 2, 3, 4, 5, 6, 20, 2, 4, 5, 0].forEach((i) => {
    queue.flush(i).then(() => {
      resolvedFlushes.push(i);
    });
  });
  await wait();
  t.is(queue.length, 5);
  t.deepEqual([20, 6, 5, 5], resolvedFlushes);

  defs[2].resolve();
  await wait();
  t.deepEqual([20, 6, 5, 5, 4, 4], resolvedFlushes);

  defs[1].resolve();
  await wait();
  t.deepEqual([20, 6, 5, 5, 4, 4, 3], resolvedFlushes);

  defs[0].resolve();
  await wait();
  t.deepEqual([20, 6, 5, 5, 4, 4, 3, 2, 2], resolvedFlushes);

  defs[3].resolve();
  await wait();
  t.deepEqual([20, 6, 5, 5, 4, 4, 3, 2, 2, 1], resolvedFlushes);

  defs[4].resolve();
  await wait();
  t.deepEqual([20, 6, 5, 5, 4, 4, 3, 2, 2, 1, 0], resolvedFlushes);
});
