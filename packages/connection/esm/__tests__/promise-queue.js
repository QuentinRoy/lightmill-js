import deferred from 'promise.defer';
import wait from 'wait-then';
import PromiseQueue from '../promise-queue';

describe('PromiseQueue', () => {
  it('#queueLength reflects the number of unresolved promises that has been pushed', async () => {
    const queue = new PromiseQueue();
    const defs = new Array(5).fill(undefined).map(deferred);
    defs[2].resolve();
    queue.push(...defs.map(({ promise }) => promise));
    await defs[2].promise;
    expect(queue.length).toBe(4);
    await defs[4].resolve();
    expect(queue.length).toBe(3);
    await defs[0].resolve();
    expect(queue.length).toBe(2);
    await defs[1].resolve();
    expect(queue.length).toBe(1);
    await defs[3].resolve();
    expect(queue.length).toBe(0);
  });

  it('#flush resolves if its queue length is smaller than the required flush', async () => {
    const queue = new PromiseQueue();
    await queue.flush(0);
    queue.push(new Promise(() => {}));
    queue.push(new Promise(() => {}));
    await queue.flush(2);
  });

  it('#flush resolves once the queue length fall below the provided length', async () => {
    const queue = new PromiseQueue();
    const defs = new Array(5).fill(undefined).map(deferred);
    const resolvedFlushes = [];
    queue.push(
      Promise.resolve(),
      ...defs.map(({ promise }) => promise),
      Promise.resolve()
    );
    [1, 2, 3, 4, 5, 6, 20, 2, 4, 5, 0].forEach(i => {
      queue.flush(i).then(() => {
        resolvedFlushes.push(i);
      });
    });
    await wait();
    expect(queue.length).toBe(5);
    expect([20, 6, 5, 5]).toEqual(resolvedFlushes);

    defs[2].resolve();
    await wait();
    expect([20, 6, 5, 5, 4, 4]).toEqual(resolvedFlushes);

    defs[1].resolve();
    await wait();
    expect([20, 6, 5, 5, 4, 4, 3]).toEqual(resolvedFlushes);

    defs[0].resolve();
    await wait();
    expect([20, 6, 5, 5, 4, 4, 3, 2, 2]).toEqual(resolvedFlushes);

    defs[3].resolve();
    await wait();
    expect([20, 6, 5, 5, 4, 4, 3, 2, 2, 1]).toEqual(resolvedFlushes);

    defs[4].resolve();
    await wait();
    expect([20, 6, 5, 5, 4, 4, 3, 2, 2, 1, 0]).toEqual(resolvedFlushes);
  });
});
