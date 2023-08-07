import { mapKeys } from 'remeda';
import { SnakeCase } from 'type-fest';
import { snakeCase } from 'change-case';

export function arrayify<T>(value: T | T[], isEmptyWithUndefined?: false): T[];
export function arrayify<T>(
  value: T | T[] | undefined,
  isEmptyWithUndefined: true,
): T[];
export function arrayify<T>(value: T | T[], isEmptyWithUndefined = false): T[] {
  if (value === undefined && isEmptyWithUndefined) return [];
  return Array.isArray(value) ? value : [value];
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
