import { mapKeys, toSnakeCase as snakeCase } from 'remeda';
import {
  ArrayIndices,
  IsNever,
  Merge,
  UnionToIntersection,
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
  value: T | Readonly<T[]>,
  isEmptyWithUndefined: true,
): T[];
export function arrayify<T>(
  value: T | Readonly<T[]>,
  isEmptyWithUndefined = false,
): T[] {
  if (value === undefined && isEmptyWithUndefined) return [];
  return Array.isArray(value) ? [...value] : [value as T];
}

export function withSnakeCaseProps<
  const R extends Record<PropertyKey, unknown>,
>(input: R) {
  return mapKeys(input, (key) =>
    typeof key === 'string' ? snakeCase(key) : key,
  ) as unknown as {
    -readonly [K in keyof R as K extends string
      ? ReturnType<typeof snakeCase<K>>
      : K]: R[K];
  };
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

export function firstStrict<T extends readonly unknown[]>(array: T): T[0] {
  return getStrict(array, 0);
}

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
