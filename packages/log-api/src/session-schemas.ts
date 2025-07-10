import { ExperimentResource } from './experiment-schemas.ts';
import {
  addIncludedToDataDocument,
  baseRequestHeaders,
  EmptyDataDocument,
  getDataDocumentSchema,
  getErrorSchema,
  getOneErrorDocumentSchema,
  getResourceIdentifierSchema,
  mediaType,
} from './jsonapi.ts';
import { LogResource } from './log-schemas.ts';
import { RunResource, RunResourceIdentifier } from './run-schemas.ts';
import { type RouteConfig, z } from './zod-openapi.ts';

export const UserRole = z.enum(['host', 'participant']);

// Resource schema
// -----------------------------------------------------------------------------
export const SessionResourceIdentifier = getResourceIdentifierSchema(
  'sessions',
).openapi('SessionResourceIdentifier');
const SessionAttributes = z.strictObject({ role: z.string().optional() });
const SessionRelationships = z.strictObject({
  runs: z.strictObject({ data: z.array(RunResourceIdentifier) }),
});
// Zod recommend using the spread operator on the shape of a zod object
// instead of using the `extend` method, but we then lose zod-to-openapi's
// ability to generate inherited schemas.
export const SessionResource = SessionResourceIdentifier.extend({
  attributes: SessionAttributes,
  relationships: SessionRelationships,
}).openapi('SessionResource');
const SessionResourceCreate = SessionResource.omit({ id: true });

// Request schemas
// -----------------------------------------------------------------------------
const SessionPostRequest = getDataDocumentSchema({
  data: SessionResourceCreate,
}).openapi('SessionPostRequest');

// Response schemas
// -----------------------------------------------------------------------------
const SessionPostResponse = getDataDocumentSchema({
  data: SessionResource,
}).openapi('SessionPostResponse');
const SessionGetResponse = addIncludedToDataDocument({
  document: SessionPostResponse,
  includes: z.union([RunResource, LogResource, ExperimentResource]).optional(),
}).openapi('SessionGetResponse');

// -----------------------------------------------------------------------------
const IncludesQuery = z
  .array(z.enum(['runs', 'runs.experiment', 'runs.lastLogs']))
  .optional()
  .describe('Related resources to include in the response');

// Error schemas
// -----------------------------------------------------------------------------
const SessionNotFoundErrorResponse = getOneErrorDocumentSchema(
  getErrorSchema({ code: 'SESSION_NOT_FOUND', statusCode: 404 }),
).openapi('SessionNotFoundErrorResponse');
const SessionExistsErrorResponse = getOneErrorDocumentSchema(
  getErrorSchema({ code: 'SESSION_EXISTS', statusCode: 409 }),
).openapi('SessionExistsErrorResponse');
const InvalidCredentialErrorResponse = getOneErrorDocumentSchema(
  getErrorSchema({ code: 'INVALID_CREDENTIALS', statusCode: 403 }),
).openapi('InvalidCredentialErrorResponse');

// Common answers
// -----------------------------------------------------------------------------
const sessionNotFoundResponse = {
  404: {
    description: 'Session not found or missing credentials',
    content: { [mediaType]: { schema: SessionNotFoundErrorResponse } },
  },
};

// Route configuration
// -----------------------------------------------------------------------------
export const sessionRoutes = {
  '/': {
    post: {
      description: 'Create a new session',
      request: {
        headers: baseRequestHeaders.extend({
          Authorization: z
            .string()
            .optional()
            .describe('Optional authorization token for the request'),
        }),
        body: { content: { [mediaType]: { schema: SessionPostRequest } } },
      },
      responses: {
        201: {
          description: 'Session created successfully',
          content: { [mediaType]: { schema: SessionPostResponse } },
          headers: z.looseObject({
            Location: z
              .string()
              .describe('The URL of the created session resource'),
            'Set-Cookie': z
              .string()
              .describe('Session cookie for the created session'),
          }),
        },
        403: {
          description: 'Invalid credentials provided',
          content: { [mediaType]: { schema: InvalidCredentialErrorResponse } },
        },
        409: {
          description: 'Client already has an active session',
          content: { [mediaType]: { schema: SessionExistsErrorResponse } },
        },
      },
    },
  },
  '/{id}': {
    get: {
      description: 'Get a session by ID',
      request: {
        params: z.strictObject({
          id: z.string().describe('ID of the session to retrieve'),
        }),
        query: z.strictObject({ include: IncludesQuery }),
        headers: baseRequestHeaders,
      },
      responses: {
        200: {
          description: 'Session retrieved successfully',
          content: { [mediaType]: { schema: SessionGetResponse } },
        },
        ...sessionNotFoundResponse,
      },
    },
    delete: {
      description: 'Delete a session by ID',
      request: {
        params: z.strictObject({
          id: z.string().describe('ID of the session to remove'),
        }),
        headers: baseRequestHeaders,
      },
      responses: {
        200: {
          description: 'Session deleted successfully',
          content: { [mediaType]: { schema: EmptyDataDocument } },
        },
        ...sessionNotFoundResponse,
      },
    },
  },
} satisfies RouteConfig;
