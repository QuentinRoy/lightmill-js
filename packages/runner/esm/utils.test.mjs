import { asyncReduce, asyncForEach, oneShot } from './utils.mjs';

let wait;
let generators;

beforeEach(() => {
  wait = t =>
    new Promise(resolve => {
      setTimeout(resolve, t);
    });

  generators = {
    sync: () => {
      const arr = ['a', 'b', 'c', 'd'];
      return arr[Symbol.iterator]();
    },
    async: async function* async() {
      yield 'a';
      await wait(0);
      yield 'b';
      await wait(0);
      yield 'c';
      await wait(0);
      yield 'd';
    }
  };
});

const describeEachSyncs = describe.each(['sync', 'async']);

describeEachSyncs(`asyncReduce with %s iterator`, sync => {
  it('reduces without init', async () => {
    const gen = generators[sync];
    // Without init.
    await expect(asyncReduce(gen(), (acc, v) => `${acc}${v},`)).resolves.toBe(
      'ab,c,d,'
    );
  });

  it('reduces with init', async () => {
    const gen = generators[sync];
    // Without init.
    await expect(
      asyncReduce(gen(), (acc, v) => `${acc}${v},`, 'test:')
    ).resolves.toBe('test:a,b,c,d,');
  });

  it('waits for async reducers', async () => {
    const gen = generators[sync];
    await expect(
      asyncReduce(
        gen(),
        (acc, v, i) => {
          const result = `${acc}${v},`;
          // return asynchronously
          if (i % 2) return wait(0).then(() => result);
          // return synchronously
          return result;
        },
        'test:'
      )
    ).resolves.toBe('test:a,b,c,d,');
  });
});

describeEachSyncs(`asyncForEach with %s iterator`, sync => {
  it('calls its callback for each values', async () => {
    const gen = generators[sync];
    const callback = jest.fn();
    await asyncForEach(gen(), callback);
    expect(callback.mock.calls).toEqual([['a'], ['b'], ['c'], ['d']]);
  });

  it('waits for its callback to resolve if it returned a promise', async () => {
    const gen = generators[sync];
    const acc = [];
    const asyncCallback = value => {
      acc.push(`${value}-async-start`);
      return wait(0).then(() => {
        acc.push(`${value}-async-end`);
      });
    };
    const syncCallback = value => {
      acc.push(`${value}-sync`);
    };
    const callback = jest.fn(
      value =>
        ['b', 'd'].includes(value) ? syncCallback(value) : asyncCallback(value)
    );

    await asyncForEach(gen(), callback);
    expect(acc).toEqual([
      'a-async-start',
      'a-async-end',
      'b-sync',
      'c-async-start',
      'c-async-end',
      'd-sync'
    ]);
  });
});
