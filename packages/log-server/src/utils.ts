import { mapKeys, toCamelCase, toSnakeCase } from 'remeda';
import {
  ArrayIndices,
  IsNever,
  Merge,
  UnionToIntersection,
  Writable,
  WritableKeysOf,
} from 'type-fest';

/**
 * Converts a value to an array. If the value is already an array, it returns a copy of the array.
 * If the value is undefined and `isEmptyWithUndefined` is true, it returns an empty array.
 *
 * @param value - The value to be converted to an array.
 * @param isEmptyWithUndefined - A flag indicating whether to return an empty array if the value is undefined.
 * @returns An array containing the value, or the value if the value was already an array, or an empty array
  if the value is undefined and `isEmptyWithUndefined` is true.
 */
export function arrayify<T>(
  value: T | Readonly<T[]>,
  isEmptyWithUndefined?: false,
): T[];
export function arrayify(value: undefined, isEmptyWithUndefined: true): [];
export function arrayify<T>(
  value: T | Readonly<T[]> | undefined,
  isEmptyWithUndefined: true,
): T[];
export function arrayify<T>(
  value: T | Readonly<T[]>,
  isEmptyWithUndefined = false,
): T[] {
  if (value === undefined && isEmptyWithUndefined) return [];
  return Array.isArray(value) ? [...value] : [value as T];
}

export type SnakeCaseProps<R extends Record<PropertyKey, unknown>> = {
  [K in keyof R as K extends string
    ? ReturnType<typeof toSnakeCase<K>>
    : K]: R[K];
};

export type LowercaseProps<R extends Record<PropertyKey, unknown>> = {
  [K in keyof R as K extends string ? Lowercase<K> : K]: R[K];
};

export function withSnakeCaseProps<
  const R extends Record<PropertyKey, unknown>,
>(input: R) {
  return mapKeys(input, (key) =>
    typeof key === 'string' ? toSnakeCase(key) : key,
  ) as unknown as Writable<SnakeCaseProps<R>>;
}

export function startsWith<S extends string, T extends string>(
  s: S,
  prefix: T,
): s is S & `${T}${string}` {
  return s.startsWith(prefix);
}

type RemovePrefixResult<
  S extends string,
  T extends string,
> = S extends `${T}${infer R}`
  ?
      | R
      // If T is a string literal, we cannot really know what will be removed
      // at the start of S, so we return the union of the remaining string.
      | (string extends T ? StringEnd<S> | S : never)

      // If T is a union, the result could either be the string without the
      // prefix, or the string itself (depending on what the prefix is).
      | (IsUnion<T> extends true ? S : never)
  : S;

export function removePrefix<S extends string, T extends string>(
  s: S,
  prefix: T,
): RemovePrefixResult<S, T> {
  if (s.startsWith(prefix)) {
    return s.slice(prefix.length) as RemovePrefixResult<S, T>;
  }
  return s as RemovePrefixResult<S, T>;
}

type StringEnd<T extends string> = T extends `${string}${infer R}`
  ? R | StringEnd<R>
  : never;

export type IsUnion<T> = [T] extends [UnionToIntersection<T>] ? false : true;

/**
 * Deeply remove properties that are readonly
 **/
export type RemoveReadonlyPropsDeep<T> =
  T extends Record<PropertyKey, unknown>
    ? { [K in WritableKeysOf<T>]: RemoveReadonlyPropsDeep<T[K]> }
    : T;

/**
 * Create an union of object types with two properties, one for the key and one
 * for the value of each property in the original object.
 **/
export type EntryAsObject<
  T,
  Options extends { key: PropertyKey; value: PropertyKey } = {
    key: 'key';
    value: 'value';
  },
> = T extends unknown
  ? {
      [K in keyof T]-?: Merge<
        { [Key in Options['key']]: K },
        { [Value in Options['value']]: T[K] }
      >;
    }[keyof T]
  : never;

/**
 * Returns the first element of an array, with strict runtime bounds checking.
 * Unlike regular array access, this function throws if the array is empty.
 *
 * @template T - The type of the array
 * @param array - The array from which to extract the first element
 * @returns The first element of the array with proper typing
 * @throws {Error} If the array is empty
 *
 * @example
 * const numbers = [1, 2, 3];
 * const first = firstStrict(numbers); // 1
 *
 * const empty: number[] = [];
 * firstStrict(empty); // Throws "Array is out of bounds"
 */
export function firstStrict<T extends readonly unknown[]>(array: T): T[0] {
  return getStrict(array, 0);
}

/**
 * Gets an element at a specified index from an array with strict runtime bounds checking
 * and precise TypeScript typing. Unlike regular array access, this function throws
 * if the index is out of bounds rather than returning undefined.
 *
 * The type system ensures that if a literal index is provided, the return type
 * precisely matches the type at that index position.
 *
 * @template T - The type of the array
 * @template N - The type of the index (number literal or number)
 * @param array - The array from which to extract the element
 * @param n - The index at which to retrieve the element
 * @returns The element at the specified index with proper typing
 * @throws {Error} If the index is out of bounds
 *
 * @example
 * const mixedTuple = [1, "two", true] as const;
 *
 * // Type-aware: returns number
 * const first = getStrict(mixedTuple, 0);
 *
 * // Type-aware: returns string
 * const second = getStrict(mixedTuple, 1);
 *
 * // Type-aware: returns boolean
 * const third = getStrict(mixedTuple, 2);
 *
 * // Runtime error: "Array is out of bounds"
 * getStrict(mixedTuple, 3);
 *
 * // With variable index, less precise typing
 * const i = Math.floor(Math.random() * 3);
 * const item = getStrict(mixedTuple, i); // type is number | string | boolean
 *
 * // With variable value, less precise typing
 * const mixedArray = [1, "two", true]
 * // returns number | string | boolean
 * const third = getStrict(mixedTuple, 2);
 */
export function getStrict<
  const T extends readonly unknown[],
  const N extends number,
>(
  array: T,
  n: N,
): number extends N
  ? T[N]
  : IsNever<ArrayIndices<T>> extends true
    ? T[N]
    : { [K in Extract<N, ArrayIndices<T>>]: T[N] }[Extract<
        N,
        ArrayIndices<T>
      >] {
  if (array.length <= n) {
    throw new Error('Array is out of bounds');
  }
  return array[n];
}

export function decodeBase64(content: string): string {
  try {
    return Buffer.from(content, 'base64').toString('utf8');
  } catch (_error) {
    throw new Error('Invalid base64 string');
  }
}

export function checkBasicAuth(
  header: string | undefined | null,
  username: string,
  password: string,
): boolean {
  if (header == null) return false;
  const [type, encoded] = header.split(' ');
  if (type !== 'Basic') {
    return false;
  }
  if (encoded == null) {
    throw new Error('Invalid Basic Authorization header');
  }
  const [authUsername, authPassword] = decodeBase64(encoded).split(':');
  if (authUsername == null || authPassword == null) {
    throw new Error('Invalid Basic Authorization header');
  }
  return authUsername === username && authPassword === password;
}

/**
 * Collects values from an AsyncIterable into an array.
 * Optionally transforms each value using a mapping function.
 *
 * @param iterable - The AsyncIterable to collect values from
 * @param map - Optional function to transform each value
 * @returns A Promise that resolves to an array of collected values
 *
 * @example
 * // Basic usage
 * const asyncIterable = getAsyncIterable();
 * const values = await fromAsync(asyncIterable);
 *
 * @example
 * // With mapping function
 * const asyncIterable = getAsyncIterable();
 * const transformed = await fromAsync(asyncIterable, x => x.toString());
 */
export async function fromAsync<T, O>(
  iterable: AsyncIterable<T>,
  map: (x: T) => Promise<O>,
): Promise<O[]>;
export async function fromAsync<T, O>(
  iterable: AsyncIterable<T>,
  map: (x: T) => O,
): Promise<O[]>;
export async function fromAsync<T>(iterable: AsyncIterable<T>): Promise<T[]>;
export async function fromAsync<T, O>(
  iterable: AsyncIterable<T>,
  map?: (x: T) => O,
) {
  let values: (T | O)[] = [];
  for await (let value of iterable) {
    values.push(map == null ? value : await map(value));
  }
  return values;
}
