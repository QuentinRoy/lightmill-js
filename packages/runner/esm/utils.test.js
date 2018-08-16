import { asyncReduce, asyncForEach } from './utils';

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
    async: async function* gen() {
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
    await expect(
      asyncReduce(gen(), (acc, v, i) => `${acc}${v}${i},`)
    ).resolves.toBe('ab1,c2,d3,');
  });

  it('reduces with init', async () => {
    const gen = generators[sync];
    // Without init.
    await expect(
      asyncReduce(gen(), (acc, v, i) => `${acc}${v}${i},`, 'test:')
    ).resolves.toBe('test:a0,b1,c2,d3,');
  });

  it('waits for async reducers', async () => {
    const gen = generators[sync];
    await expect(
      asyncReduce(
        gen(),
        (acc, v, i) => {
          const result = `${acc}${v}${i},`;
          // return asynchronously
          if (i % 2) return wait(0).then(() => result);
          // return synchronously
          return result;
        },
        'test:'
      )
    ).resolves.toBe('test:a0,b1,c2,d3,');
  });
});

describeEachSyncs(`asyncForEach with %s iterator`, sync => {
  it('calls its callback for each values', async () => {
    const gen = generators[sync];
    const callback = jest.fn();
    await asyncForEach(gen(), callback);
    expect(callback.mock.calls).toEqual([
      ['a', 0],
      ['b', 1],
      ['c', 2],
      ['d', 3]
    ]);
  });
  it('waits for its callback to resolve if it returned a promise', async () => {
    const gen = generators[sync];
    const acc = [];
    const asyncCallback = (value, i) => {
      acc.push(`${value}${i}-async-start`);
      return wait(0).then(() => {
        acc.push(`${value}${i}-async-end`);
      });
    };
    const syncCallback = (value, i) => {
      acc.push(`${value}${i}-sync`);
    };
    const callback = jest.fn(
      (value, i) => (i % 2 ? syncCallback(value, i) : asyncCallback(value, i))
    );

    await asyncForEach(gen(), callback);
    expect(acc).toEqual([
      'a0-async-start',
      'a0-async-end',
      'b1-sync',
      'c2-async-start',
      'c2-async-end',
      'd3-sync'
    ]);
  });
});
