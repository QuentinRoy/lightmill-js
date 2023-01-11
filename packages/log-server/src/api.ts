import { z } from 'zod';
import { JsonObject, JsonValue } from './utils.js';

type OkAnswer = { status: 'ok' };

export const PostRunsBody = z.object({
  id: z.string().optional(),
  experimentId: z.string().optional(),
});
export type PostRunsAnswer = OkAnswer & { id: string };

export const PostSessionBody = z
  .object({
    role: z.enum(['admin', 'participant']).default('participant'),
    password: z.string().optional(),
  })
  .strict();
export type PutSessionAnswer = OkAnswer & {
  role: z.output<typeof PostSessionBody>['role'];
};

export type GetSessionAnswer = OkAnswer & {
  session: {
    runId?: string;
    role: z.output<typeof PostSessionBody>['role'];
  };
};

export type DeleteSessionAnswer = OkAnswer;

export const PutRunsBody = z
  .object({
    ended: z.boolean(),
  })
  .strict();
export type PutRunsAnswer = OkAnswer;

const PostLogsBodyLog = z
  .object({
    type: z.string(),
    values: JsonObject,
  })
  .strict();
export const PostLogsBody = z.union([
  z
    .object({
      runId: z.string(),
      log: PostLogsBodyLog,
    })
    .strict(),
  z
    .object({
      runId: z.string(),
      logs: z.array(PostLogsBodyLog),
    })
    .strict(),
]);
export type PostLogsAnswer = OkAnswer;

export const GetLogsParams = z
  .object({
    type: z.union([z.string(), z.array(z.string())]).optional(),
    runId: z.union([z.string(), z.array(z.string())]).optional(),
    experimentId: z.union([z.string(), z.array(z.string())]).optional(),
    format: z.enum(['json', 'csv']).default('json'),
  })
  .strict();
export type GetLogsAnswer = JsonValue[] | string; // WARNING: This is not checked.

export type ErrorAnswer = { status: 'error'; message: string };
