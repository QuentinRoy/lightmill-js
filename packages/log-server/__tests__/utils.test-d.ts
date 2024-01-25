import { describe, it, expect, expectTypeOf } from 'vitest';
import {
  IsUnion,
  arrayify,
  removePrefix,
  startsWith,
  toSnakeCase,
} from '../src/utils.js';

describe('startsWith', () => {
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
  it('should narrow types', () => {
    expectTypeOf(startsWith).guards.toEqualTypeOf<string>();
    expectTypeOf(
      startsWith<string, 'foo'>,
    ).guards.toEqualTypeOf<`foo${string}`>();
    expectTypeOf(
      startsWith<'foo' | 'bar' | 'foobar' | 'barfoo', 'foo'>,
    ).guards.toEqualTypeOf<'foo' | 'foobar'>();
    expectTypeOf(startsWith<string, 'foo' | 'bar'>).guards.toEqualTypeOf<
      `foo${string}` | `bar${string}`
    >();
    expectTypeOf(
      startsWith<'foo' | 'bar' | 'foobar' | 'barfoo' | 'nope', 'foo' | 'bar'>,
    ).guards.toEqualTypeOf<'foo' | 'bar' | 'foobar' | 'barfoo'>();
    expectTypeOf(
      startsWith<`${'a' | 'b'}-${'c' | 'd'}`, 'a'>,
    ).guards.toEqualTypeOf<'a-c' | 'a-d'>();
  });
});

describe('removePrefix', () => {
  it('remove prefix from a target starts with prefix', () => {
    expect(removePrefix('foobar', 'foo')).toBe('bar');
    expect(removePrefix('foo', 'foo')).toBe('');
    expect(removePrefix('foo', '')).toBe('foo');
  });
  it('leave target unchanged if it does not start with prefix', () => {
    expect(removePrefix('foobar', 'bar')).toBe('foobar');
    expect(removePrefix('', 'foo')).toBe('');
  });
  it('should narrow types with literal prefix and literal target', () => {
    expectTypeOf(removePrefix<'foo', 'foo'>).returns.toEqualTypeOf<''>();
    expectTypeOf(removePrefix<'foobar', 'foo'>).returns.toEqualTypeOf<'bar'>();
    expectTypeOf(
      removePrefix<'foobar', 'bar'>,
    ).returns.toEqualTypeOf<'foobar'>();
    expectTypeOf(removePrefix<'foo', ''>).returns.toEqualTypeOf<'foo'>();
    expectTypeOf(removePrefix<'', 'foo'>).returns.toEqualTypeOf<''>();
  });

  it('should narrow types with literal prefix and union target', () => {
    expectTypeOf(removePrefix<'foo' | 'bar', 'fo'>).returns.toEqualTypeOf<
      'o' | 'bar'
    >();
    expectTypeOf(removePrefix<'foo' | 'bar', ''>).returns.toEqualTypeOf<
      'foo' | 'bar'
    >();
    expectTypeOf(removePrefix<'foo' | 'bar', 'foo'>).returns.toEqualTypeOf<
      '' | 'bar'
    >();
  });

  it('should narrow types with complicated generic types', () => {
    expectTypeOf(removePrefix).returns.toEqualTypeOf<string>();
    expectTypeOf(removePrefix<'foo', string>).returns.toEqualTypeOf<
      'foo' | 'oo' | 'o' | ''
    >();
    expectTypeOf(removePrefix<'foo' | 'bar', string>).returns.toEqualTypeOf<
      'foo' | 'oo' | 'o' | 'bar' | 'ar' | 'r' | ''
    >();
    expectTypeOf(removePrefix<'foobar', 'fo' | 'foob'>).returns.toEqualTypeOf<
      'ar' | 'obar' | 'foobar'
    >();
    expectTypeOf(removePrefix<'foo' | 'bar', 'fo' | 'b'>).returns.toEqualTypeOf<
      'o' | 'ar' | 'foo' | 'bar'
    >();
  });
});

describe('arrayify', () => {
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

describe('toSnakeCase', () => {
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
  it('provides correct types', () => {
    expectTypeOf(
      toSnakeCase<{ foo: number; barBaz: 'hello'; quxQuux: string }>,
    ).returns.toEqualTypeOf<{
      foo: number;
      bar_baz: 'hello';
      qux_quux: string;
    }>();
  });
});

describe('IsUnion', () => {
  it('is the type true if its generic type is an union', () => {
    expectTypeOf<IsUnion<'foo' | 'bar'>>().toEqualTypeOf<true>();
    expectTypeOf<IsUnion<string | number>>().toEqualTypeOf<true>();
  });
  it('is the type false if its generic type is not an union', () => {
    expectTypeOf<IsUnion<'foo'>>().toEqualTypeOf<false>();
    expectTypeOf<IsUnion<string>>().toEqualTypeOf<false>();
    expectTypeOf<IsUnion<string | 'bar'>>().toEqualTypeOf<false>();
    expectTypeOf<IsUnion<1 | 2 | number>>().toEqualTypeOf<false>();
    expectTypeOf<IsUnion<4 | never>>().toEqualTypeOf<false>();
    expectTypeOf<IsUnion<4 | 'bar' | unknown>>().toEqualTypeOf<false>();
  });
});
