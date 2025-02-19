import { z } from 'zod';
import { extendZodWithOpenApi } from '@anatine/zod-openapi';

extendZodWithOpenApi(z);

const literal = z.union([z.string(), z.number(), z.boolean(), z.null()]);
type Literal = z.infer<typeof literal>;
export type Json = Literal | { [key: string]: Json } | Json[];
export const json: z.ZodType<Json> = z.lazy(() =>
  z.union([literal, z.array(json), z.record(json)]),
);

export type Log = {
  type: string;
  number: number;
  values: Record<string, Json>;
};

// We are using a type annotation here, otherwise ts-rest tends to generate very
// long and crazy for jsonSchema.
export const log: z.ZodType<Log> = z.object({
  type: z.string(),
  // Required for input too because requests may arrive out of order.
  number: z.number(),
  values: z.record(z.string(), json),
});

export type RunStatus =
  | 'idle'
  | 'running'
  | 'completed'
  | 'interrupted'
  | 'canceled';
export const runStatus: z.ZodType<RunStatus> = z.enum([
  'idle',
  'running',
  'completed',
  'interrupted',
  'canceled',
]);

export const run = z
  .object({ experimentName: z.string(), runName: z.string() })
  .strict();
export type Run = z.output<typeof run>;

export const runWithStatus = run.extend({ runStatus: runStatus }).strict();
export type RunWithStatus = z.output<typeof runWithStatus>;

export const runWithInfo = runWithStatus
  .extend({
    runCreatedAt: z.string(),
    logs: z.array(
      z
        .object({
          type: z.string(),
          count: z.number(),
          pending: z.number(),
          lastNumber: z.number(),
        })
        .strict(),
    ),
  })
  .strict();

export const okResponse = z.object({});
export const errorResponse = z.object({ message: z.string() });

type UserRole = 'host' | 'participant';
export const userRole: z.ZodType<UserRole> = z.enum(['host', 'participant']);
