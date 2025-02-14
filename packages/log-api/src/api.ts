import { initContract } from '@ts-rest/core';
import { z } from 'zod';
import * as schemas from './schemas.js';

const contractBuilder = initContract();

const runResultSchema = z.object({
  runCreatedAt: z.string(),
  runName: z.string(),
  experimentName: z.string(),
  runStatus: schemas.runStatus,
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
});

const runsContract = contractBuilder.router({
  create: {
    summary: 'Create a new run',
    method: 'PUT',
    path: '/experiments/:experimentName/runs/:runName',
    pathParams: z.object({ experimentName: z.string(), runName: z.string() }),
    body: z
      .object({ runStatus: schemas.runStatus.default('idle') })
      .strict()
      .default({ runStatus: 'idle' }),
    responses: {
      201: schemas.okResponse.extend({
        experimentName: z.string(),
        runName: z.string(),
        runStatus: z.string(),
      }),
      400: schemas.errorResponse,
      403: schemas.errorResponse,
    },
  },

  getFromExperiment: {
    summary: 'Get information about all runs of an experiment',
    method: 'GET',
    path: '/experiments/:experimentName/runs',
    pathParams: z.object({ experimentName: z.string() }),
    responses: {
      200: schemas.okResponse.extend({ runs: z.array(runResultSchema) }),
      404: schemas.errorResponse,
    },
  },

  get: {
    summary: 'Get information about a run',
    method: 'GET',
    path: '/experiments/:experimentName/runs/:runName',
    pathParams: z.object({ experimentName: z.string(), runName: z.string() }),
    responses: {
      200: schemas.okResponse
        .extend({
          run: z
            .object({
              runName: z.string(),
              experimentName: z.string(),
              runStatus: schemas.runStatus,
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
        })
        .strict(),
      404: schemas.errorResponse,
    },
  },

  update: {
    summary: 'Update the status of a run',
    method: 'PATCH',
    path: '/experiments/:experimentName/runs/:runName',
    pathParams: z.object({ experimentName: z.string(), runName: z.string() }),
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
      200: schemas.okResponse,
      404: schemas.errorResponse,
      403: schemas.errorResponse,
      400: schemas.errorResponse,
    },
  },
});

const logsContract = contractBuilder.router({
  get: {
    method: 'GET',
    path: '/experiments/:experimentName/logs',
    pathParams: z.object({ experimentName: z.string() }),
    query: z.object({
      type: z.union([z.string(), z.array(z.string())]).optional(),
    }),
    responses: {
      200: schemas.okResponse.extend({ logs: z.array(schemas.log) }),
      404: schemas.errorResponse,
    },
  },

  post: {
    method: 'POST',
    path: '/experiments/:experimentName/runs/:runName/logs',
    pathParams: z.object({ experimentName: z.string(), runName: z.string() }),
    body: z.object({ logs: z.array(schemas.log) }),
    responses: {
      201: schemas.okResponse,
      404: schemas.errorResponse,
      403: schemas.errorResponse,
      400: schemas.errorResponse,
    },
  },
});

const sessionsContract = contractBuilder.router({
  get: {
    summary: 'Get the current session (check login)',
    method: 'GET',
    path: '/current',
    responses: {
      200: schemas.okResponse
        .extend({
          role: schemas.userRole,
          runs: z.array(schemas.run.strict()),
        })
        .strict(),
      404: schemas.errorResponse,
    },
  },

  put: {
    summary: 'Set the current session (login)',
    method: 'PUT',
    path: '/current',
    body: z
      .object({
        role: schemas.userRole.default('participant'),
        password: z.string().optional(),
      })
      .strict(),
    responses: {
      201: schemas.okResponse
        .extend({
          role: schemas.userRole,
          runs: z.array(schemas.run.strict()),
        })
        .strict(),
      400: schemas.errorResponse,
      403: schemas.errorResponse,
    },
  },

  delete: {
    summary: 'Delete the current session (logout)',
    method: 'DELETE',
    path: '/current',
    responses: {
      201: schemas.okResponse,
      404: schemas.errorResponse,
      403: schemas.errorResponse,
    },
  },
});

export const contract = contractBuilder.router(
  { sessions: sessionsContract, runs: runsContract, logs: logsContract },
  { strictStatusCodes: true },
);
