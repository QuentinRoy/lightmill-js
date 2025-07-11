import {
  getDataDocumentSchema,
  getErrorSchema,
  getOneErrorDocumentSchema,
  getResourceIdentifierSchema,
  mediaType,
} from './jsonapi.ts';
import { ForbiddenErrorResponse, StringOrArrayOfStrings } from './utils.ts';
import { z, type RouteConfig } from './zod-openapi.ts';

// Resource schema
// -----------------------------------------------------------------------------
export const ExperimentResourceIdentifier = getResourceIdentifierSchema(
  'experiments',
).openapi('ExperimentResourceIdentifier');
const ExperimentAttributes = z
  .strictObject({ name: z.string().min(1).describe('Name of the experiment') })
  .openapi('ExperimentAttributes');
// Zod recommend using the spread operator on the shape of a zod object
// instead of using the `extend` method, but we then lose zod-to-openapi's
// ability to generate inherited schemas.
export const ExperimentResource = z
  .strictObject({
    ...ExperimentResourceIdentifier.shape,
    attributes: ExperimentAttributes,
  })
  .openapi('ExperimentResource');
const ExperimentResourceCreate = ExperimentResource.omit({ id: true }).openapi(
  'ExperimentResourceCreate',
);

// Query parameters schemas
// -----------------------------------------------------------------------------
const ExperimentQueryFilter = z.strictObject({
  'filter[name]': StringOrArrayOfStrings.optional(),
});

// Requests schemas
// -----------------------------------------------------------------------------
const ExperimentPostRequest = getDataDocumentSchema({
  data: ExperimentResourceCreate,
}).openapi('ExperimentPostRequest');

// OK Response schemas
// -----------------------------------------------------------------------------
const ExperimentGetResponse = getDataDocumentSchema({
  data: ExperimentResource,
}).openapi('ExperimentGetResponse');
const ExperimentGetCollectionResponse = getDataDocumentSchema({
  data: z.array(ExperimentResource),
}).openapi('ExperimentGetCollectionResponse');
const ExperimentPostResponse = getDataDocumentSchema({
  data: ExperimentResourceIdentifier,
}).openapi('ExperimentPostResponse');

// Error Response schemas
// -----------------------------------------------------------------------------
const ExperimentNotFoundErrorResponse = getOneErrorDocumentSchema(
  getErrorSchema({ code: 'EXPERIMENT_NOT_FOUND', statusText: 'Not Found' }),
).openapi('ExperimentNotFoundErrorResponse');
const ExperimentExistsErrorResponse = getOneErrorDocumentSchema(
  getErrorSchema({ code: 'EXPERIMENT_EXISTS', statusText: 'Conflict' }),
).openapi('ExperimentExistsErrorResponse');

// Route configuration
// -----------------------------------------------------------------------------
export const experimentRoutes = {
  '/': {
    get: {
      description: 'List all experiments',
      request: { query: ExperimentQueryFilter },
      responses: {
        200: {
          description: 'List of experiments',
          content: { [mediaType]: { schema: ExperimentGetCollectionResponse } },
        },
      },
    },
    post: {
      description: 'Create a new experiment.',
      request: {
        body: { content: { [mediaType]: { schema: ExperimentPostRequest } } },
      },
      responses: {
        201: {
          description: 'Experiment created successfully',
          content: { [mediaType]: { schema: ExperimentPostResponse } },
          headers: z.looseObject({ Location: z.string() }),
        },
        403: {
          description: 'Forbidden',
          content: { [mediaType]: { schema: ForbiddenErrorResponse } },
        },
        409: {
          description: 'Experiment already exists',
          content: { [mediaType]: { schema: ExperimentExistsErrorResponse } },
        },
      },
    },
  },
  '/{id}': {
    get: {
      description: 'Get a specific experiment by ID',
      request: {
        params: z.object({ id: z.string().describe('ID of the experiment') }),
      },
      responses: {
        200: {
          description: 'Experiment retrieved successfully',
          content: { [mediaType]: { schema: ExperimentGetResponse } },
        },
        404: {
          description: 'Experiment not found',
          content: { [mediaType]: { schema: ExperimentNotFoundErrorResponse } },
        },
      },
    },
  },
} satisfies RouteConfig;
