import { initContract } from '@ts-rest/core';
import { z } from 'zod';
import * as schemas from './schemas.js';

export type Log = schemas.Log;
export type Run = schemas.Run;
export type RunStatus = schemas.RunStatus;

const c = initContract();
export const contract = c.router(
  {
    createNewRun: {
      summary: 'Create a new run',
      method: 'POST',
      path: '/runs',
      body: schemas.runWithStatus.partial().strict(),
      responses: {
        201: schemas.okResponse.extend({
          experimentName: z.string(),
          runName: z.string(),
          runStatus: schemas.runStatus,
        }),
        400: schemas.errorResponse,
        403: schemas.errorResponse,
        405: schemas.errorResponse,
      },
    },

    getExperimentRuns: {
      summary: 'Get information about all runs of an experiment',
      method: 'GET',
      path: '/experiments/:experimentName/runs',
      pathParams: z.object({ experimentName: z.string() }),
      responses: {
        200: schemas.okResponse.extend({
          runs: z.array(schemas.runWithStatus),
        }),
        403: schemas.errorResponse,
        404: schemas.errorResponse,
      },
    },

    getRun: {
      summary: 'Get information about a run',
      method: 'GET',
      path: '/experiments/:experimentName/runs/:runName',
      pathParams: schemas.run,
      responses: {
        200: schemas.okResponse.merge(schemas.runWithInfo).strict(),
        404: schemas.errorResponse,
      },
    },

    updateRun: {
      summary: 'Update the status of a run',
      method: 'PATCH',
      path: '/experiments/:experimentName/runs/:runName',
      pathParams: schemas.run,
      body: z.discriminatedUnion('runStatus', [
        z
          .object({
            runStatus: z.enum(['completed', 'interrupted', 'canceled']),
          })
          .strict(),
        z
          .object({
            runStatus: z.literal('running'),
            resumeFrom: z.number().optional(),
          })
          .strict(),
      ]),
      responses: {
        200: schemas.okResponse.optional(),
        400: schemas.errorResponse,
        403: schemas.errorResponse,
        404: schemas.errorResponse,
        405: schemas.errorResponse,
      },
    },

    getLogs: {
      method: 'GET',
      path: '/experiments/:experimentName/logs',
      pathParams: z.object({ experimentName: z.string() }),
      query: z
        .object({ type: z.union([z.string(), z.array(z.string())]).optional() })
        .strict(),
      headers: z.object({
        Accept: z.enum(['text/csv', 'application/json']).optional(),
      }),
      responses: {
        // Unfortunately there is currently no way to specify two possible content types.
        // Consequently, we only declare the response type for the JSON content type.
        // On the server, we will have to let the CSV content be a type error.
        // In generate-openapi.ts, we will use a custom mapper to specify the response for
        // the CSV content type.
        // 200: c.otherResponse({ contentType: 'text/csv', body: z.string() }),
        200: schemas.okResponse.extend({ logs: z.array(schemas.log) }),
        404: schemas.errorResponse,
      },
      strictStatusCodes: false,
    },

    postLogs: {
      method: 'POST',
      path: '/experiments/:experimentName/runs/:runName/logs',
      pathParams: schemas.run,
      body: z.object({ logs: z.array(schemas.log) }),
      responses: {
        201: schemas.okResponse.optional(),
        404: schemas.errorResponse,
        403: schemas.errorResponse,
        405: schemas.errorResponse,
        400: schemas.errorResponse,
      },
    },

    getSession: {
      summary: 'Get the current session (check login)',
      method: 'GET',
      path: '/sessions/current',
      responses: {
        200: schemas.okResponse
          .extend({
            role: schemas.userRole,
            runs: z.array(schemas.runWithStatus.strict()),
          })
          .strict(),
        404: schemas.errorResponse,
      },
    },

    putSession: {
      summary: 'Set the current session (login)',
      method: 'PUT',
      path: '/sessions/current',
      body: z
        .object({
          role: schemas.userRole.optional(),
          password: z.string().optional(),
        })
        .strict()
        .optional(),
      responses: {
        // When user was already logged in.
        200: schemas.okResponse
          .extend({
            role: schemas.userRole,
            runs: z.array(schemas.runWithStatus),
          })
          .strict(),
        // When user was not logged in.
        201: schemas.okResponse
          .extend({
            role: schemas.userRole,
            runs: z.array(schemas.runWithStatus),
          })
          .strict(),
        // When user was not logged in and password is incorrect.
        403: schemas.errorResponse,
      },
    },

    deleteSession: {
      summary: 'Delete the current session (logout)',
      method: 'DELETE',
      path: '/sessions/current',
      responses: {
        200: schemas.okResponse.optional(),
        404: schemas.errorResponse,
      },
    },
  },
  { strictStatusCodes: true },
);
