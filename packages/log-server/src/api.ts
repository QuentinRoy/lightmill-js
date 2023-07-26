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
import { JsonObject } from './utils.js';

const OkResponse = z.object({ status: z.literal('ok') });
const ErrorResponse = z.object({
  status: z.literal('error'),
  message: z.string(),
});
const Role = z.enum(['admin', 'participant']);
const LogParameter = z.object({
  type: z.string(),
  values: JsonObject,
  date: z.string().datetime(),
});

export const api = makeApi([
  {
    method: 'post',
    path: '/sessions',
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
      runs: z.array(z.string()),
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
        z.object({ id: z.string(), experiment: z.string() }).strict(),
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
    path: '/experiments/runs',
    parameters: [
      {
        schema: z
          .object({
            id: z.string().optional(),
            experiment: z.string().optional(),
          })
          .strict()
          .optional(),
        name: 'body',
        type: 'Body',
      },
    ],
    response: OkResponse.extend({
      run: z.string(),
      experiment: z.string(),
      links: z
        .object({
          logs: z.string(),
          run: z.string(),
        })
        .strict(),
    }).strict(),
    errors: [
      { status: 403, schema: ErrorResponse.strict() },
      { status: 400, schema: ErrorResponse.strict() },
    ],
  },
  {
    method: 'put',
    path: '/experiments/:experiment/runs/:run',
    response: OkResponse.strict(),
    errors: [
      { status: 404, schema: ErrorResponse.strict() },
      { status: 403, schema: ErrorResponse.strict() },
      { status: 400, schema: ErrorResponse.strict() },
    ],
    parameters: [
      {
        schema: z
          .object({
            status: z.union([z.literal('completed'), z.literal('canceled')]),
          })
          .strict(),
        name: 'body',
        type: 'Body',
      },
    ],
  },
  {
    method: 'post',
    path: '/experiments/:experiment/runs/:run/logs',
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
    path: '/experiments/:experiment/runs/logs',
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
  Status extends number,
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
// I can ditch it if I want to later without breaking change.
