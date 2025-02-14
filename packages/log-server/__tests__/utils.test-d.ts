import { describe, it, expectTypeOf } from 'vitest';
import {
  IsUnion,
  removePrefix,
  startsWith,
  toSnakeCase,
} from '../src/utils.js';

describe('startsWith', () => {
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
    expectTypeOf(removePrefix<'xa' | 'xb', 'x'>).returns.toEqualTypeOf<
      'a' | 'b'
    >();
    expectTypeOf(removePrefix<'xxx', 'x'>).returns.toEqualTypeOf<'xx'>();
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

describe('toSnakeCase', () => {
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
