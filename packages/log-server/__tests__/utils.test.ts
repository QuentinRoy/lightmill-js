import { describe, it, expect } from 'vitest';
import {
  arrayify,
  removePrefix,
  startsWith,
  toSnakeCase,
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

describe.concurrent('toSnakeCase', () => {
  it('converts an objects key to snake case', () => {
    expect(
      toSnakeCase({
        foo: 'bar',
        barBaz: 'qux',
        quxQuux: 'quuz',
      }),
    ).toEqual({
      foo: 'bar',
      bar_baz: 'qux',
      qux_quux: 'quuz',
    });
  });
});

describe.concurrent('removePrefix', () => {
  it('remove prefix from a target starts with prefix', () => {
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
