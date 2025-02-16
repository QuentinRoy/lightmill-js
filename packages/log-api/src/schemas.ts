import { z } from 'zod';

export const jsonPrimitive = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);

type JsonPrimitive = z.infer<typeof jsonPrimitive>;
type JsonValue =
  | JsonPrimitive
  | ({ [Key in string]: JsonValue } & {
      [Key in string]?: JsonValue | undefined;
    })
  | JsonValue[]
  | readonly JsonValue[];

export const jsonValue: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([jsonPrimitive, z.array(jsonValue), z.record(jsonValue)]),
);
export const jsonObject = z.record(jsonValue);

export const jsonArray = z.array(jsonValue);

export const log = z.object({
  type: z.string(),
  // Required for input too because requests may arrive out of order.
  number: z.number(),
  values: jsonObject,
});

export const runStatus = z.enum([
  'idle',
  'running',
  'completed',
  'interrupted',
  'canceled',
]);

export const run = z.object({
  experimentName: z.string(),
  runName: z.string(),
  runStatus: runStatus,
});

export const okResponse = z.object({ status: z.literal('ok') });
export const errorResponse = z.object({
  status: z.literal('error'),
  message: z.string(),
});

export const userRole = z.enum(['host', 'participant']);
