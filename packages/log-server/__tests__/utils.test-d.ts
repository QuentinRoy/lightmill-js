import { describe, expectTypeOf, it } from 'vitest';
import {
  type EntryAsObject,
  type IsUnion,
  type RemoveReadonlyPropsDeep,
  fromAsync,
  removePrefix,
  startsWith,
  withSnakeCaseProps,
} from '../src/utils.ts';

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

describe('withSnakeCaseProps', () => {
  it('provides correct types', () => {
    expectTypeOf(
      withSnakeCaseProps<{ foo: number; barBaz: 'hello'; quxQuux: string }>,
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

describe('RemoveReadonlyPropsDeep', () => {
  it('removes readonly properties from a simple object', () => {
    type Input = { readonly a: 'thing'; b: 'hello' };
    type Expected = { b: 'hello' };
    type Actual = RemoveReadonlyPropsDeep<Input>;
    expectTypeOf<Actual>().toEqualTypeOf<Expected>();
  });
  it('removes readonly properties from a nested object', () => {
    type Input = { a: { readonly b: 'thing'; c: 'hello' } };
    type Expected = { a: { c: 'hello' } };
    type Actual = RemoveReadonlyPropsDeep<Input>;
    expectTypeOf<Actual>().toEqualTypeOf<Expected>();
  });
  it('removes readonly properties from a deeply nested object', () => {
    type Input = { a: { readonly b: 'thing'; c: 'hello' }; x: 'world' };
    type Expected = { x: 'world'; a: { c: 'hello' } };
    type Actual = RemoveReadonlyPropsDeep<Input>;
    expectTypeOf<Actual>().toEqualTypeOf<Expected>();
  });
  it('removes readonly properties from a deeply nested object with multiple readonly properties', () => {
    type Input = {
      readonly a: { readonly b: 'thing'; c: 'hello' };
      x: 'world';
      y: { readonly z: 'foo'; w: 'bar' };
    };
    type Expected = { x: 'world'; y: { w: 'bar' } };
    type Actual = RemoveReadonlyPropsDeep<Input>;
    expectTypeOf<Actual>().toEqualTypeOf<Expected>();
  });
});

describe('EntryAsObject', () => {
  it('creates object entries with key and value properties', () => {
    type TestObject = { a: number; b: string };

    expectTypeOf<EntryAsObject<TestObject>>().toEqualTypeOf<
      { key: 'a'; value: number } | { key: 'b'; value: string }
    >();
  });

  it('handles custom property names', () => {
    type TestObject = { a: number; b: string };

    expectTypeOf<
      EntryAsObject<TestObject, { key: 'prop'; value: 'val' }>
    >().toEqualTypeOf<
      { prop: 'a'; val: number } | { prop: 'b'; val: string }
    >();
  });

  it('handles nested object types', () => {
    type Nested = { user: { name: string; id: number } };

    expectTypeOf<EntryAsObject<Nested>>().toEqualTypeOf<{
      key: 'user';
      value: { name: string; id: number };
    }>();
  });

  it('handles readonly properties', () => {
    type WithReadonly = { readonly id: string; name: string };

    expectTypeOf<EntryAsObject<WithReadonly>>().toEqualTypeOf<
      { key: 'id'; value: string } | { key: 'name'; value: string }
    >();
  });

  it('handles optional properties', () => {
    type WithOptional = { id: number; name?: string };
    type Expected =
      | { key: 'id'; value: number }
      | { key: 'name'; value: string | undefined };
    type Actual = EntryAsObject<WithOptional>;
    expectTypeOf<Actual>().toEqualTypeOf<Expected>();
  });

  it('handles interfaces', () => {
    interface TestInterface {
      id: number;
      value: string;
    }
    expectTypeOf<EntryAsObject<TestInterface>>().toEqualTypeOf<
      { key: 'id'; value: number } | { key: 'value'; value: string }
    >();
  });

  it('handles records', () => {
    type TestRecord = Record<'a' | 'b', boolean>;
    expectTypeOf<EntryAsObject<TestRecord>>().toEqualTypeOf<
      { key: 'a'; value: boolean } | { key: 'b'; value: boolean }
    >();
  });

  it('handles empty objects', () => {
    expectTypeOf<
      EntryAsObject<Record<never, unknown>>
    >().toEqualTypeOf<never>();
  });

  it('handles unions', () => {
    type Input = { a: 'a1' | 'a2' } | { b: 'b1' | 'b2'; c: 'c' };
    type Expected =
      | { key: 'a'; value: 'a1' | 'a2' }
      | { key: 'b'; value: 'b1' | 'b2' }
      | { key: 'c'; value: 'c' };
    type Actual = EntryAsObject<Input>;
    expectTypeOf<Actual>().toEqualTypeOf<Expected>();
  });
});

describe('fromAsync', () => {
  it('should return an array of the same type with no mapping function', () => {
    const asyncIterable: AsyncIterable<number> = {
      [Symbol.asyncIterator]: () => ({
        next: async () => ({ done: true, value: undefined }),
      }),
    };

    expectTypeOf(fromAsync(asyncIterable)).resolves.toEqualTypeOf<number[]>();
  });

  it('should return an array of mapped type with sync mapping function', () => {
    const asyncIterable: AsyncIterable<number> = {
      [Symbol.asyncIterator]: () => ({
        next: async () => ({ done: true, value: undefined }),
      }),
    };

    expectTypeOf(
      fromAsync(asyncIterable, (x: number) => x.toString()),
    ).resolves.toEqualTypeOf<string[]>();
  });

  it('should return an array of mapped type with async mapping function', () => {
    const asyncIterable: AsyncIterable<number> = {
      [Symbol.asyncIterator]: () => ({
        next: async () => ({ done: true, value: undefined }),
      }),
    };

    expectTypeOf(
      fromAsync(asyncIterable, async (x: number) => x.toString()),
    ).resolves.toEqualTypeOf<string[]>();
  });

  it('should handle complex return types from mapping function', () => {
    const asyncIterable: AsyncIterable<string> = {
      [Symbol.asyncIterator]: () => ({
        next: async () => ({ done: true, value: undefined }),
      }),
    };

    expectTypeOf(
      fromAsync(asyncIterable, (x: string) => ({
        original: x,
        length: x.length,
      })),
    ).resolves.toEqualTypeOf<Array<{ original: string; length: number }>>();
  });

  it('should handle union types in the iterator', () => {
    const asyncIterable: AsyncIterable<string | number> = {
      [Symbol.asyncIterator]: () => ({
        next: async () => ({ done: true, value: undefined }),
      }),
    };

    expectTypeOf(fromAsync(asyncIterable)).resolves.toEqualTypeOf<
      Array<string | number>
    >();

    expectTypeOf(
      fromAsync(asyncIterable, (x) =>
        typeof x === 'string' ? x.length : x * 2,
      ),
    ).resolves.toEqualTypeOf<number[]>();
  });

  it('should infer the correct return type with async mapping function', async () => {
    const asyncIterable: AsyncIterable<number> = {
      [Symbol.asyncIterator]: () => ({
        next: async () => ({ done: true, value: undefined }),
      }),
    };

    const asyncMapper = (n: number): Promise<string> => {
      return Promise.resolve(n.toString());
    };

    expectTypeOf(fromAsync(asyncIterable, asyncMapper)).resolves.toEqualTypeOf<
      string[]
    >();
  });
});
