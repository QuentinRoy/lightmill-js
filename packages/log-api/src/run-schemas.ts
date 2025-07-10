import {
  loginRequiredResponse,
  SessionRequiredErrorResponse,
  StringOrArrayOfStrings,
} from './common.ts';
import {
  ExperimentResource,
  ExperimentResourceIdentifier,
} from './experiment-schemas.ts';
import {
  getDataDocumentSchema,
  getErrorSchema,
  getOneErrorDocumentSchema,
  getResourceIdentifierSchema,
  mediaType,
} from './jsonapi.ts';
import {
  LogResourceIdentifier as LogResourceIdentifierImport,
  LogResource as LogResourceImport,
} from './log-schemas.ts';
import { z, type RouteConfig } from './zod-openapi.ts';

// Fix circular dependencies by using lazy evaluation, but since we are using
// zod-to-openapi, we need to use the `openapi` method to ensure
// the schemas are correctly referenced in the OpenAPI document.
// C.f. https://github.com/asteasolutions/zod-to-openapi/issues/247
const LogResourceIdentifier = z
  .lazy(() => LogResourceIdentifierImport)
  .openapi({
    type: 'object',
    allOf: [{ $ref: '#/components/schemas/LogResourceIdentifier' }],
    additionalProperties: false,
  });

const LogResource = z
  .lazy(() => LogResourceImport)
  .openapi({
    type: 'object',
    allOf: [{ $ref: '#/components/schemas/LogResource' }],
    additionalProperties: false,
  });

// Resource schema
// -----------------------------------------------------------------------------
export const RunResourceIdentifier = getResourceIdentifierSchema(
  'runs',
).openapi('RunResourceIdentifier');
const RunResourceIdentifierWrite = RunResourceIdentifier.omit({ id: true });
const RunStatus = z
  .enum(['idle', 'running', 'completed', 'interrupted', 'canceled'])
  .openapi('RunStatus');
const RunAttributes = z
  .strictObject({
    status: RunStatus.describe('Status of the run'),
    name: z.union([z.string().min(1), z.null()]).describe('Name of the run'),
    lastLogNumber: z.number().int().nonnegative(),
    missingLogNumbers: z.array(z.number().int().nonnegative()),
  })
  .openapi('RunAttributes');
const RunAttributesUpdate = RunAttributes.omit({
  missingLogNumbers: true,
  name: true,
});
const RunAttributesCreate = RunAttributes.omit({
  lastLogNumber: true,
  missingLogNumbers: true,
});
// Zod recommend using the spread operator on the shape of a zod object
// instead of using the `extend` method, but we then lose zod-to-openapi's
// ability to generate inherited schemas.
const RunRelationships = z.strictObject({
  experiment: z.strictObject({ data: ExperimentResourceIdentifier }),
  lastLogs: z.strictObject({ data: z.array(LogResourceIdentifier) }),
});
const RunResourceCreate = RunResourceIdentifierWrite.extend({
  attributes: RunAttributesCreate,
  relationships: RunRelationships.pick({ experiment: true }),
});
const RunResourceUpdate = RunResourceIdentifierWrite.extend({
  attributes: RunAttributesUpdate,
  relationships: RunRelationships.pick({ experiment: true }),
});
export const RunResource = RunResourceIdentifier.extend({
  attributes: RunAttributes,
  relationships: RunRelationships,
}).openapi('RunResource');

// Request schemas
// -----------------------------------------------------------------------------
const RunPostRequest = getDataDocumentSchema({
  data: RunResourceCreate,
}).openapi('RunPostRequest');
const RunPatchRequest = getDataDocumentSchema({
  data: RunResourceUpdate,
}).openapi('RunPatchRequest');

// Query parameters schemas
// -----------------------------------------------------------------------------
const RunIncludeName = z.enum(['experiment', 'lastLogs']);
const RunIncludeQuery = z.strictObject({
  include: z.union([RunIncludeName, z.array(RunIncludeName)]).optional(),
});
const RunFilterQuery = z.strictObject({
  'filter[experiment.id]': StringOrArrayOfStrings.optional(),
  'filter[experiment.name]': StringOrArrayOfStrings.optional(),
  'filter[id]': StringOrArrayOfStrings.optional(),
  'filter[name]': StringOrArrayOfStrings.optional(),
  'filter[status]': z.union([RunStatus, z.array(RunStatus)]).optional(),
});

// OK Response schemas
// -----------------------------------------------------------------------------
const RunPostResponse = getDataDocumentSchema({
  data: RunResourceIdentifier,
}).openapi('RunPostResponse');
const RunInclude = z
  .union([ExperimentResource, LogResource])
  .openapi('RunInclude');
const RunGetResponse = getDataDocumentSchema({
  data: RunResource,
  includes: RunInclude,
}).openapi('RunGetResponse');
const RunGetCollectionResponse = getDataDocumentSchema({
  data: z.array(RunResource),
  includes: RunInclude,
}).openapi('RunGetCollectionResponse');

// Error Response schemas
// -----------------------------------------------------------------------------
const runOnGoingErrorHttpCode = 403 as const;
const CannotCreateRunErrorResponse = getOneErrorDocumentSchema(
  getErrorSchema({
    code: ['ON_GOING_RUN', 'EXPERIMENT_NOT_FOUND'],
    statusCode: runOnGoingErrorHttpCode,
  }),
).openapi('CannotCreateRunErrorResponse');
const runExistsErrorHttpCode = 409 as const;
const RunExistsErrorResponse = getOneErrorDocumentSchema(
  getErrorSchema({ code: 'RUN_EXISTS', statusCode: runExistsErrorHttpCode }),
).openapi('RunExistsErrorReponse');
const runNotFoundErrorHttpCode = 404 as const;
const RunNotFoundErrorResponse = getOneErrorDocumentSchema(
  getErrorSchema({
    code: 'RUN_NOT_FOUND',
    statusCode: runNotFoundErrorHttpCode,
  }),
).openapi('RunNotFoundErrorResponse');
const RunInvalidUpdateErrorResponse = getOneErrorDocumentSchema(
  getErrorSchema({
    code: [
      'INVALID_STATUS_TRANSITION',
      'INVALID_LAST_LOG_NUMBER',
      'PENDING_LOGS',
      'INVALID_ROLE',
      'INVALID_RUN_ID',
    ],
    statusCode: 403,
  }),
).openapi('RunInvalidUpdateErrorResponse');

// Route configuration
// -----------------------------------------------------------------------------
export const runRoutes = {
  '/': {
    post: {
      description: 'Create a new run',
      request: {
        body: { content: { [mediaType]: { schema: RunPostRequest } } },
      },
      responses: {
        201: {
          description: 'Run created successfully',
          headers: z.looseObject({ Location: z.string() }),
          content: { [mediaType]: { schema: RunPostResponse } },
        },
        403: {
          description:
            'Forbidden: run creation is invalid or user is not logged in',
          content: {
            [mediaType]: {
              schema: z.union([
                SessionRequiredErrorResponse,
                CannotCreateRunErrorResponse,
              ]),
            },
          },
        },
        409: {
          description: 'Run already exists',
          content: { [mediaType]: { schema: RunExistsErrorResponse } },
        },
      },
    },
    get: {
      description: 'List all runs',
      request: {
        query: z.strictObject({
          ...RunFilterQuery.shape,
          ...RunIncludeQuery.shape,
        }),
      },
      responses: {
        200: {
          description: 'List of runs',
          content: { [mediaType]: { schema: RunGetCollectionResponse } },
        },
      },
    },
  },
  '/{id}': {
    get: {
      description: 'Get a run by its ID',
      request: {
        params: z.object({ id: z.string().describe('ID of the run') }),
        query: RunIncludeQuery,
      },
      responses: {
        200: {
          description: 'Run retrieved successfully',
          content: { [mediaType]: { schema: RunGetResponse } },
        },
        404: {
          description: 'Run not found',
          content: { [mediaType]: { schema: RunNotFoundErrorResponse } },
        },
        ...loginRequiredResponse,
      },
    },
    patch: {
      description: 'Update a run by its ID',
      request: {
        params: z.object({ id: z.string().describe('ID of the run') }),
        body: { content: { [mediaType]: { schema: RunPatchRequest } } },
      },
      responses: {
        200: {
          description: 'Run updated successfully',
          content: { [mediaType]: { schema: RunGetResponse } },
        },
        404: {
          description: 'Run not found',
          content: { [mediaType]: { schema: RunNotFoundErrorResponse } },
        },
        403: {
          description: 'Run update is invalid or user is not logged in',
          content: {
            [mediaType]: {
              schema: z.union([
                CannotCreateRunErrorResponse,
                RunInvalidUpdateErrorResponse,
                SessionRequiredErrorResponse,
              ]),
            },
          },
        },
      },
    },
  },
} satisfies RouteConfig;
