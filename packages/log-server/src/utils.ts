import { mapKeys } from 'remeda';
import { SnakeCase, UnionToIntersection } from 'type-fest';
import { snakeCase } from 'change-case';
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
  return Array.isArray(value) ? [...value] : [value];
}

export function toSnakeCase<
  R extends Record<string | number | symbol, unknown>,
>(input: R) {
  return mapKeys(input, (key) =>
    typeof key === 'string' ? snakeCase(key) : key,
  ) as unknown as {
    [K in keyof R as SnakeCase<K>]: R[K];
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
