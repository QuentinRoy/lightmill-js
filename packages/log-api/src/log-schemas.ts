import { StringOrArrayOfStrings } from './common.ts';
import { ExperimentResource } from './experiment-schemas.ts';
import {
  getDataDocumentSchema,
  getErrorSchema,
  getOneErrorDocumentSchema,
  getResourceIdentifierSchema,
  mediaType,
} from './jsonapi.ts';
import * as Run from './run-schemas.ts';
import { z, type RouteConfig } from './zod-openapi.ts';

// Fix circular dependencies by using lazy evaluation, but since we are using
// zod-to-openapi, we need to use the `openapi` method to ensure
// the schemas are correctly referenced in the OpenAPI document.
const RunResourceIdentifier = z
  .lazy(() => Run.RunResourceIdentifier)
  .openapi({
    type: 'object',
    allOf: [{ $ref: '#/components/schemas/RunResourceIdentifier' }],
    additionalProperties: false,
  });
const RunResource = z
  .lazy(() => Run.RunResource)
  .openapi({
    type: 'object',
    allOf: [{ $ref: '#/components/schemas/RunResource' }],
    additionalProperties: false,
  });

// Resource schema
// -----------------------------------------------------------------------------
export const LogResourceIdentifier = getResourceIdentifierSchema(
  'logs',
).openapi('LogResourceIdentifier');
const LogAttributes = z.strictObject({
  number: z
    .number()
    .int()
    .min(1)
    .describe(
      'The number of the log. This is a number that is unique for the run the log belongs to. Log numbers must be sequential and start at 1. Logs must not necessarily be created in order, but any missing log must be created before the run is completed, and any log following a missing log is considered pending.',
    ),
  logType: z
    .string()
    .describe(
      'The type of the log. This is not the same as the resource type (which is always "logs" for  logs). This is a type that describes the kind of log. For example, it could be "trial", "event", etc.',
    ),
  values: z
    .record(z.string(), z.unknown())
    .describe(
      'The values of the log. They may be any JSON object. However, it is recommended to use flat objects as nested objects are difficult to serialize to CSV. It is also recommended to use a consistent schema for all logs of the same type.',
    ),
});
const LogRelationships = z
  .strictObject({ run: z.strictObject({ data: RunResourceIdentifier }) })
  .openapi('LogRelationships');
export const LogResource = LogResourceIdentifier.extend({
  attributes: LogAttributes,
  relationships: LogRelationships,
}).openapi('LogResource');

// Query parameters schemas
// -----------------------------------------------------------------------------
const LogIncludeName = z.enum(['run', 'run.experiment', 'run.lastLogs']);
const LogQueryInclude = z.strictObject({
  include: z.union([LogIncludeName, z.array(LogIncludeName)]).optional(),
});
const LogQueryFilter = z.strictObject({
  'filter[logType]': StringOrArrayOfStrings.optional(),
  'filter[experiment.id]': StringOrArrayOfStrings.optional(),
  'filter[experiment.name]': StringOrArrayOfStrings.optional(),
  'filter[run.name]': StringOrArrayOfStrings.optional(),
  'filter[run.id]': StringOrArrayOfStrings.optional(),
});

// Request schemas
// -----------------------------------------------------------------------------
const LogPostRequest = z
  .strictObject({ data: LogResource.omit({ id: true }) })
  .openapi('LogPostRequest');

// OK Response schemas
const LogInclude = z
  .union([RunResource, ExperimentResource, LogResource])
  .openapi('LogInclude');
const LogGetResponse = getDataDocumentSchema({
  data: LogResource,
  includes: LogInclude,
}).openapi('LogGetResponse');
const LogGetCollectionResponse = getDataDocumentSchema({
  data: z.array(LogResource),
  includes: LogInclude,
}).openapi('LogGetCollectionResponse');

// Error Response schemas
const LogNotFoundErrorResponse = getOneErrorDocumentSchema(
  getErrorSchema({ code: 'LOG_NOT_FOUND', statusCode: 404 }),
).openapi('LogNotFoundErrorResponse');

export const logRoutes = {
  '/': {
    get: {
      request: {
        query: LogQueryFilter.extend(LogQueryInclude.shape),
        headers: z.strictObject({
          Accept: z
            .string()
            .describe(
              'This endpoint may return CSV (default) or JSON as a function of this header.',
            ),
        }),
      },
      responses: {
        200: {
          description: 'List of logs',
          content: {
            [mediaType]: { schema: LogGetCollectionResponse },
            'text/csv': {
              schema: z.string().describe('CSV representation of the logs'),
            },
          },
        },
      },
    },
    post: {
      description: 'Create a new log',
      request: {
        body: { content: { [mediaType]: { schema: LogPostRequest } } },
      },
      responses: {
        201: {
          description: 'Log created successfully',
          headers: z.looseObject({ Location: z.string() }),
          content: { [mediaType]: { schema: LogGetResponse } },
        },
        403: {
          description: 'Forbidden',
          content: {
            [mediaType]: {
              schema: getOneErrorDocumentSchema(
                getErrorSchema({
                  code: ['RUN_NOT_FOUND', 'INVALID_RUN_STATUS'],
                  statusCode: 403,
                }),
              ),
            },
          },
        },
        409: {
          description: 'Log number already exists',
          content: {
            [mediaType]: {
              schema: getOneErrorDocumentSchema(
                getErrorSchema({ code: 'LOG_NUMBER_EXISTS', statusCode: 409 }),
              ),
            },
          },
        },
      },
    },
  },
  '/{id}': {
    get: {
      description: 'Get a specific log by ID',
      request: {
        params: z.object({ id: z.string().describe('ID of the log') }),
        query: LogQueryInclude,
      },
      responses: {
        200: {
          description: 'Log retrieved successfully',
          content: { [mediaType]: { schema: LogGetResponse } },
        },
        404: {
          description: 'Log not found',
          content: { [mediaType]: { schema: LogNotFoundErrorResponse } },
        },
      },
    },
  },
} satisfies RouteConfig;
