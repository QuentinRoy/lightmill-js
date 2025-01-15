import {
  makeApi,
  ZodiosBodyByPath,
  ZodiosEndpointDefinitionByPath,
  ZodiosErrorByPath,
  ZodiosPathParamsByPath,
  ZodiosPathsByMethod,
  ZodiosQueryParamsByPath,
  ZodiosResponseByPath,
} from '@zodios/core';
import { z } from 'zod';
import { JsonObject, NonEmptyArray } from './utils.js';

const OkResponse = z.object({ status: z.literal('ok') });
const ErrorResponse = z.object({
  status: z.literal('error'),
  message: z.string(),
});
const Role = z.enum(['host', 'participant']);
const LogParameter = z.object({
  type: z.string(),
  // Required because requests can arrive out of order.
  number: z.number(),
  values: JsonObject,
});

const runStatusSchema = z.enum([
  'idle',
  'running',
  'completed',
  'interrupted',
  'canceled',
]);

type RunStatus = z.output<typeof runStatusSchema>;

export const api = makeApi([
  {
    method: 'put',
    path: '/sessions/current',
    parameters: [
      {
        schema: z
          .object({
            role: Role.default('participant'),
            password: z.string().optional(),
          })
          .strict(),
        name: 'body',
        type: 'Body',
      },
    ],
    response: OkResponse.extend({
      role: Role,
      runs: z.array(
        z
          .object({
            experimentName: z.string(),
            runName: z.string(),
            runStatus: runStatusSchema,
          })
          .strict(),
      ),
    }).strict(),
    errors: [
      { status: 400, schema: ErrorResponse },
      { status: 403, schema: ErrorResponse },
    ],
  },
  {
    method: 'get',
    path: '/sessions/current',
    response: OkResponse.extend({
      runs: z.array(
        z
          .object({
            experimentName: z.string(),
            runName: z.string(),
            runStatus: runStatusSchema,
          })
          .strict(),
      ),
      role: Role,
    }).strict(),
    errors: [{ status: 404, schema: ErrorResponse }],
  },
  {
    method: 'delete',
    path: '/sessions/current',
    response: OkResponse.strict(),
    errors: [
      { status: 404, schema: ErrorResponse.strict() },
      { status: 403, schema: ErrorResponse.strict() },
    ],
  },
  {
    method: 'post',
    path: '/runs',
    parameters: [
      {
        schema: z
          .object({
            runName: z.string().optional(),
            experimentName: z.string().optional(),
            runStatus: z
              .enum(['running', 'idle'] satisfies NonEmptyArray<RunStatus>)
              .optional(),
          })
          .strict()
          .optional(),
        name: 'body',
        type: 'Body',
      },
    ],
    response: OkResponse.extend({
      experimentName: z.string(),
      runName: z.string(),
      runStatus: z.string(),
    }).strict(),
    errors: [{ status: 403, schema: ErrorResponse.strict() }],
  },
  {
    method: 'get',
    path: '/experiments/:experimentName/runs',
    response: OkResponse.extend({
      runs: z.array(
        z
          .object({
            runCreatedAt: z.string(),
            runId: z.number(),
            runName: z.string(),
            experimentName: z.string(),
            runStatus: runStatusSchema,
          })
          .strict(),
      ),
    }).strict(),
    errors: [{ status: 403, schema: ErrorResponse.strict() }],
  },
  {
    method: 'get',
    path: '/experiments/:experimentName/runs/:runName',
    response: OkResponse.extend({
      run: z
        .object({
          runName: z.string(),
          experimentName: z.string(),
          runStatus: runStatusSchema,
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
        .strict(),
    }).strict(),
    errors: [{ status: 403, schema: ErrorResponse.strict() }],
  },
  {
    method: 'patch',
    path: '/experiments/:experimentName/runs/:runName',
    response: OkResponse.strict(),
    errors: [
      { status: 404, schema: ErrorResponse.strict() },
      { status: 403, schema: ErrorResponse.strict() },
      { status: 400, schema: ErrorResponse.strict() },
    ],
    parameters: [
      {
        schema: z.union([
          z
            .object({
              runStatus: z.enum([
                'running',
                'completed',
                'interrupted',
                'canceled',
              ]),
            })
            .strict(),
          z
            .object({
              resumeFrom: z.number(),
              runStatus: z.literal('running'),
            })
            .strict(),
        ]),
        name: 'body',
        type: 'Body',
      },
    ],
  },
  {
    method: 'post',
    path: '/experiments/:experimentName/runs/:runName/logs',
    parameters: [
      {
        schema: z.union([
          z.object({ log: LogParameter.strict() }).strict(),
          z.object({ logs: z.array(LogParameter.strict()) }).strict(),
        ]),
        name: 'body',
        type: 'Body',
      },
    ],
    response: OkResponse,
    errors: [{ status: 403, schema: ErrorResponse.strict() }],
  },
  {
    method: 'get',
    path: '/experiments/:experimentName/logs',
    parameters: [
      {
        name: 'type',
        type: 'Query',
        schema: z.union([z.string(), z.array(z.string())]).optional(),
      },
    ],
    response: z.union([z.array(JsonObject), z.string()]),
    errors: [{ status: 403, schema: ErrorResponse.strict() }],
  },
]);

type Api = typeof api;

export type Path = Api[number]['path'];
export type Method = Api[number]['method'];
export type PathParams<
  M extends Method,
  P extends ZodiosPathsByMethod<Api, M>,
> = ZodiosPathParamsByPath<Api, M, P>;
export type QueryParams<
  M extends Method,
  P extends ZodiosPathsByMethod<Api, M>,
> = ZodiosQueryParamsByPath<Api, M, P>;
export type Body<
  M extends Method,
  P extends ZodiosPathsByMethod<Api, M>,
> = ZodiosBodyByPath<Api, M, P>;
export type Response<
  M extends Method,
  P extends ZodiosPathsByMethod<Api, M>,
> = ZodiosResponseByPath<Api, M, P>;
export type Error<
  M extends Method,
  P extends ZodiosPathsByMethod<Api, M>,
  Status extends number = number,
> = ZodiosErrorByPath<Api, M, P, Status>;
export type ErrorStatus<
  M extends Method,
  P extends ZodiosPathsByMethod<Api, M>,
> = ZodiosEndpointDefinitionByPath<Api, M, P>[number] extends {
  errors: Array<{ status: infer S }>;
}
  ? S
  : never;

// Why not export Zodios api as the recommended way to use it? I am not sure
// I want to use zodios on the client, it depends on zod and could uselessly
// bloat the client. I would rather hide its usage from the lib consumers so
// I can later ditch it if I want to without breaking change.
