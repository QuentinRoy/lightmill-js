import { z } from 'zod';

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

export function isNonEmptyArray<T>(array: T[]): array is [T, ...T[]] {
  return array.length > 0;
}

export function nonEmptyArray<T>(schema: z.ZodType<T>) {
  return z.array(schema).refine(isNonEmptyArray, {
    message: 'Expected a non-empty array',
  });
}
export type NonEmptyArray<T> = z.infer<ReturnType<typeof nonEmptyArray<T>>>;
