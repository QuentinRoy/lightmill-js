import { getErrorSchema, getOneErrorDocumentSchema } from './jsonapi.ts';
import { z } from './zod-openapi.ts';

export function mapKeys<
  T extends object,
  M extends (k: Extract<keyof T, string>) => PropertyKey,
>(obj: T, fn: M) {
  return Object.fromEntries(
    Object.entries(obj).map(([key, value]) => {
      // @ts-expect-error: we assume T has no extra properties so key is
      // a valid key of T.
      return [fn(key), value];
    }),
  ) as { [K in keyof T as ReturnType<M>]: T[K] };
}

export function prefixKeys<T extends Record<string, unknown>, P extends string>(
  obj: T,
  prefix: P,
) {
  return mapKeys(obj, (k) => {
    return `${prefix}${k as keyof T & (string | number)}` as const;
  });
}

// Common types
export const StringOrArrayOfStrings = z
  .union([z.string(), z.array(z.string())])
  .openapi('StringOrArrayOfStrings');

export const ForbiddenErrorResponse = getOneErrorDocumentSchema(
  getErrorSchema({
    code: 'FORBIDDEN',
    statusText: 'Forbidden',
    statusCode: 403,
  }),
).openapi('ForbiddenErrorResponse');
