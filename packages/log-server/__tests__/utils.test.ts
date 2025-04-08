import { describe, expect, it } from 'vitest';
import {
  arrayify,
  fromAsync,
  removePrefix,
  startsWith,
  withSnakeCaseProps,
} from '../src/utils.js';

describe.concurrent('arrayify', () => {
  it('returns an array with the same value if it is not an array', () => {
    expect(arrayify(1)).toEqual([1]);
    expect(arrayify('foo')).toEqual(['foo']);
    expect(arrayify({ foo: 'bar' })).toEqual([{ foo: 'bar' }]);
    expect(arrayify(undefined)).toEqual([undefined]);
  });

  it('returns an empty array if the value is undefined and isEmptyWithUndefined is true', () => {
    expect(arrayify(undefined, true)).toEqual([]);
  });

  it('returns an empty array if the value is an empty array', () => {
    expect(arrayify([])).toEqual([]);
  });

  it('returns a copy of the array if the value is an array', () => {
    let arr = [1, 2, 3];
    let newArr = arrayify(arr);
    expect(arr).toEqual(newArr);
    expect(arr).not.toBe(newArr);
  });
});

describe.concurrent('withSnakeCaseProps', () => {
  it("converts an object's properties to snake case", () => {
    expect(
      withSnakeCaseProps({ foo: 'bar', barBaz: 'qux', quxQuux: 'quuz' }),
    ).toEqual({ foo: 'bar', bar_baz: 'qux', qux_quux: 'quuz' });
  });
});

describe.concurrent('removePrefix', () => {
  it('remove prefix from the start of a string', () => {
    expect(removePrefix('foobar', 'foo')).toBe('bar');
    expect(removePrefix('foo', 'foo')).toBe('');
    expect(removePrefix('foo', '')).toBe('foo');
    expect(removePrefix('xxx', 'x')).toBe('xx');
  });

  it('leave target unchanged if it does not start with prefix', () => {
    expect(removePrefix('foobar', 'bar')).toBe('foobar');
    expect(removePrefix('', 'foo')).toBe('');
  });
});

describe.concurrent('startsWith', () => {
  it('returns true if the target starts with the prefix', () => {
    expect(startsWith('foo', 'foo')).toBe(true);
    expect(startsWith('foo', '')).toBe(true);
    expect(startsWith('foobar', 'foo')).toBe(true);
  });
  it('returns false if the target does no start with the prefix', () => {
    expect(startsWith('foo', 'foo')).toBe(true);
    expect(startsWith('foo', '')).toBe(true);
    expect(startsWith('foobar', 'foo')).toBe(true);
  });
});

describe.concurrent('fromAsync', () => {
  it('collects values from an AsyncIterable into an array', async () => {
    async function* generator() {
      yield 1;
      yield 2;
      yield 3;
    }

    const result = await fromAsync(generator());
    expect(result).toEqual([1, 2, 3]);
  });

  it('works with empty AsyncIterable', async () => {
    async function* emptyGenerator() {
      // yields nothing
    }

    const result = await fromAsync(emptyGenerator());
    expect(result).toEqual([]);
  });

  it('transforms values using provided mapping function', async () => {
    async function* generator() {
      yield 1;
      yield 2;
      yield 3;
    }

    const result = await fromAsync(generator(), (x) => x * 2);
    expect(result).toEqual([2, 4, 6]);
  });

  it('handles async mapping function', async () => {
    async function* generator() {
      yield 'a';
      yield 'b';
      yield 'c';
    }

    const result = await fromAsync(generator(), async (x) => {
      return x.toUpperCase();
    });

    expect(result).toEqual(['A', 'B', 'C']);
  });

  it('preserves order from the AsyncIterable', async () => {
    async function* delayedGenerator() {
      // Yield items with varying delays to test ordering
      await new Promise((resolve) => setTimeout(resolve, 0));
      yield 'c';

      await new Promise((resolve) => setTimeout(resolve, 0));
      yield 'b';

      await new Promise((resolve) => setTimeout(resolve, 0));
      yield 'a';
    }

    const result = await fromAsync(delayedGenerator());
    expect(result).toEqual(['c', 'b', 'a']);
  });
});
