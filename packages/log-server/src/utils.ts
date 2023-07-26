import { mapKeys } from 'remeda';
import { SnakeCase } from 'type-fest';
import { snakeCase } from 'change-case';
import { z } from 'zod';

export function arrayify<T>(value: T | T[], isEmptyWithUndefined?: false): T[];
export function arrayify<T>(
  value: T | T[] | undefined,
  isEmptyWithUndefined: true,
): T[];
export function arrayify<T>(value: T | T[], isEmptyWithUndefined = false): T[] {
  if (value === undefined && isEmptyWithUndefined) return [];
  return Array.isArray(value) ? value : [value];
}

export const JsonPrimitive = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);
export type JsonPrimitive = z.infer<typeof JsonPrimitive>;
export type JsonValue =
  | JsonPrimitive
  | ({ [Key in string]: JsonValue } & {
      [Key in string]?: JsonValue | undefined;
    })
  | JsonValue[]
  | readonly JsonValue[];
export const JsonValue: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([JsonPrimitive, z.array(JsonValue), z.record(JsonValue)]),
);
export const JsonObject = z.record(JsonValue);
export type JsonObject = z.infer<typeof JsonObject>;
export const JsonArray = z.array(JsonValue);
export type JsonArray = z.infer<typeof JsonArray>;

export function toSnakeCase<
  R extends Record<string | number | symbol, unknown>,
>(input: R) {
  return mapKeys(input, (key) =>
    typeof key === 'string' ? snakeCase(key) : key,
  ) as unknown as {
    [K in keyof R as SnakeCase<K>]: R[K];
  };
}
