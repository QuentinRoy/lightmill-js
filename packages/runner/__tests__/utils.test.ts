import { describe, expect, it, vi } from 'vitest';
import { asyncForEach } from '../src/utils.js';

function wait(t = 0) {
  return new Promise((resolve) => {
    setTimeout(resolve, t);
  });
}

const generators = {
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
const throwingGenerators = {
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

type Deffered<V> = {
  promise: Promise<V>;
  resolve: () => void;
  reject: (err?: Error) => void;
};
function deffer<V>(value: V): Deffered<V>;
function deffer(): Deffered<void>;
function deffer<V>(value?: V) {
  let resolve: () => void;
  let reject: (err?: Error) => void;
  const promise = new Promise<V>((res, rej) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolve = () => res(value as any);
    reject = rej;
  });
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return { promise, resolve: resolve!, reject: reject! };
}

const describeEachSyncs = describe.each(['sync', 'async']);

describeEachSyncs(`asyncForEach with %s iterator`, (syncArg) => {
  const sync = syncArg as 'sync' | 'async';
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
    const gen = generators[sync];
    const defers = { b: deffer(), d: deffer() };
    const log: string[] = [];
    const callback = vi.fn((value) => {
      if (value in defers) {
        log.push(`${value}-async-start`);
        return defers[value].promise.then(() => {
          log.push(`${value}-async-end`);
        });
      } else {
        log.push(`${value}-sync`);
      }
    });
    const end = vi.fn();
    let forEachProm = (asyncForEach(gen(), callback) as Promise<void>).then(
      () => end()
    );
    expect(end.mock.calls).toEqual([]);
    await wait(5);
    expect(log).toEqual(['a-sync', 'b-async-start']);
    defers.b.resolve();
    await wait(5);
    expect(end.mock.calls).toEqual([]);
    expect(log).toEqual([
      'a-sync',
      'b-async-start',
      'b-async-end',
      'c-sync',
      'd-async-start',
    ]);
    expect(end.mock.calls).toEqual([]);
    defers.d.resolve();
    await forEachProm;
    expect(log).toEqual([
      'a-sync',
      'b-async-start',
      'b-async-end',
      'c-sync',
      'd-async-start',
      'd-async-end',
    ]);
    expect(end.mock.calls).toEqual([[]]);
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
