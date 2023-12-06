import { mapKeys } from 'remeda';
import { SnakeCase, UnionToIntersection } from 'type-fest';
import { snakeCase } from 'change-case';

export function arrayify<T>(
  value: T | Readonly<T[]>,
  isEmptyWithUndefined?: false,
): T[];
export function arrayify<T>(
  value: T | Readonly<T[]> | undefined,
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
