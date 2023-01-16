import { makeApi } from '@zodios/core';
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
    response: OkResponse.extend({ role: Role }).strict(),
    errors: [
      { status: 400, schema: ErrorResponse },
      { status: 403, schema: ErrorResponse },
    ],
  },
  {
    method: 'get',
    path: '/sessions/current',
    response: OkResponse.extend({
      runId: z.string().optional(),
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
            id: z.string().optional(),
            experimentId: z.string().optional(),
          })
          .strict(),
        name: 'body',
        type: 'Body',
      },
    ],
    response: OkResponse.extend({ id: z.string() }).strict(),
    errors: [
      { status: 403, schema: ErrorResponse.strict() },
      { status: 400, schema: ErrorResponse.strict() },
    ],
  },
  {
    method: 'put',
    path: '/runs/:id',
    response: OkResponse.strict(),
    errors: [
      { status: 404, schema: ErrorResponse.strict() },
      { status: 403, schema: ErrorResponse.strict() },
      { status: 400, schema: ErrorResponse.strict() },
    ],
    parameters: [
      {
        schema: z.string(),
        name: 'id',
        type: 'Path',
      },
      {
        schema: z.object({ ended: z.boolean() }).strict(),
        name: 'body',
        type: 'Body',
      },
    ],
  },
  {
    method: 'post',
    path: '/logs',
    parameters: [
      {
        schema: z.union([
          z
            .object({
              runId: z.string(),
              log: LogParameter.strict(),
            })
            .strict(),
          z
            .object({
              runId: z.string(),
              logs: z.array(LogParameter.strict()),
            })
            .strict(),
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
    path: '/logs',
    parameters: [
      {
        name: 'type',
        type: 'Query',
        schema: z.union([z.string(), z.array(z.string())]).optional(),
      },
      {
        name: 'runId',
        type: 'Query',
        schema: z.union([z.string(), z.array(z.string())]).optional(),
      },
      {
        name: 'experimentId',
        type: 'Query',
        schema: z.union([z.string(), z.array(z.string())]).optional(),
      },
      {
        name: 'format',
        type: 'Query',
        schema: z.union([z.literal('csv'), z.literal('json')]).default('json'),
      },
    ],
    response: z.union([z.array(JsonObject), z.string()]),
    errors: [{ status: 403, schema: ErrorResponse.strict() }],
  },
]);
