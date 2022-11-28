import { describe, expect, it, vi } from 'vitest';
import { asyncForEach } from '../src/utils.js';

function wait(t: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, t);
  });
}

let generators = {
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
  },
};
let throwingGenerators = {
  sync: function* syncThatThrows() {
    yield 'a';
    yield 'b';
    throw new Error('mock-generator-error');
  },
  async: async function* syncThatThrows() {
    yield 'a';
    await wait(0);
    yield 'b';
    await wait(0);
    throw new Error('mock-generator-error');
  },
};

const describeEachSyncs = describe.each(['sync', 'async']);

describeEachSyncs(`asyncForEach with %s iterator`, (sync) => {
  it('calls its callback for each values', async () => {
    const gen = generators[sync as 'sync' | 'async'];
    const callback = vi.fn();
    await asyncForEach(gen(), callback);
    expect(callback.mock.calls).toEqual([
      ['a', 0],
      ['b', 1],
      ['c', 2],
      ['d', 3],
    ]);
  });

  it('waits for its callback to resolve if it returned a promise', async () => {
    const gen = generators[sync as 'sync' | 'async'];
    const acc: string[] = [];
    const asyncCallback = async (value: string) => {
      acc.push(`${value}-async-start`);
      await wait(0);
      acc.push(`${value}-async-end`);
    };
    const syncCallback = (value: string) => {
      acc.push(`${value}-sync`);
    };
    const callback = vi.fn((value) =>
      ['b', 'd'].includes(value) ? syncCallback(value) : asyncCallback(value)
    );
    await asyncForEach(gen(), callback);
    expect(acc).toEqual([
      'a-async-start',
      'a-async-end',
      'b-sync',
      'c-async-start',
      'c-async-end',
      'd-sync',
    ]);
  });

  it('rejects if a sync callback throws', async () => {
    const gen = generators[sync as 'sync' | 'async'];
    const callback = vi.fn((v) => {
      if (v === 'b') throw new Error('mock-callback-error');
    });
    if (sync === 'sync') {
      expect(() => asyncForEach(gen(), callback)).toThrow(
        'mock-callback-error'
      );
    } else {
      await expect(asyncForEach(gen(), callback)).rejects.toThrow(
        'mock-callback-error'
      );
    }
    expect(callback.mock.calls).toEqual([
      ['a', 0],
      ['b', 1],
    ]);
  });

  it('rejects if an async callback throws', async () => {
    const gen = generators[sync as 'sync' | 'async'];
    const callback = vi.fn((v) =>
      wait(0).then(() => {
        if (v === 'b') throw new Error('mock-callback-error');
      })
    );
    await expect(asyncForEach(gen(), callback)).rejects.toThrow(
      'mock-callback-error'
    );
    expect(callback.mock.calls).toEqual([
      ['a', 0],
      ['b', 1],
    ]);
  });

  it('rejects if the iterator throws', async () => {
    const gen = throwingGenerators[sync as 'sync' | 'async'];
    const callback = vi.fn();
    if (sync === 'sync') {
      expect(() => asyncForEach(gen(), callback)).toThrow(
        'mock-generator-error'
      );
    } else {
      await expect(asyncForEach(gen(), callback)).rejects.toThrow(
        'mock-generator-error'
      );
    }
    expect(callback.mock.calls).toEqual([
      ['a', 0],
      ['b', 1],
    ]);
  });
});
