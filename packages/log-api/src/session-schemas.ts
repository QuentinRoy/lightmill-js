import { ExperimentResource } from './experiment-schemas.ts';
import {
  addIncludedToDataDocument,
  EmptyDataDocument,
  getDataDocumentSchema,
  getErrorSchema,
  getOneErrorDocumentSchema,
  getResourceIdentifierSchema,
  mediaType,
} from './jsonapi.ts';
import { LogResource } from './log-schemas.ts';
import { RunResource, RunResourceIdentifier } from './run-schemas.ts';
import { cookieAuth } from './security.ts';
import { registry, type RouteConfig, z } from './zod-openapi.ts';

export const UserRole = z.enum(['host', 'participant']);

// Resource schema
// -----------------------------------------------------------------------------
export const SessionResourceIdentifier = getResourceIdentifierSchema(
  'sessions',
).openapi('SessionResourceIdentifier');
const SessionAttributes = z.strictObject({ role: UserRole.optional() });
const SessionRelationships = z.strictObject({
  runs: z.strictObject({ data: z.array(RunResourceIdentifier) }),
});
export const SessionResource = z
  .strictObject({
    ...SessionResourceIdentifier.shape,
    attributes: SessionAttributes,
    relationships: SessionRelationships,
  })
  .openapi('SessionResource');
const SessionResourceCreate = SessionResource.omit({
  id: true,
  relationships: true,
});

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
  getErrorSchema({
    code: ['INVALID_CREDENTIALS', 'MISSING_CREDENTIALS'],
    statusCode: 403,
  }),
).openapi('InvalidCredentialErrorResponse');

// Common answers
// -----------------------------------------------------------------------------
const sessionNotFoundResponse = {
  404: {
    description: 'Session not found or missing credentials',
    content: { [mediaType]: { schema: SessionNotFoundErrorResponse } },
  },
};

// Authentication
// -----------------------------------------------------------------------------
const basicAuth = registry.registerComponent('securitySchemes', 'BasicAuth', {
  type: 'http',
  scheme: 'Basic',
});

// Route configuration
// -----------------------------------------------------------------------------
export const sessionRoutes = {
  '/': {
    post: {
      description: 'Create a new session',
      security: [{}, { [basicAuth.name]: [] }],
      request: {
        body: { content: { [mediaType]: { schema: SessionPostRequest } } },
        headers: z.looseObject({
          Authorization: z
            .string()
            .optional()
            .describe(
              'Basic authentication header for host role. Format: "Basic base64(username:password)"',
            ),
        }),
      },
      responses: {
        201: {
          description:
            'Session created successfully.  If necessary, login and password are provided using the basic authentication scheme. The session ID is returned in a cookie to be used with cookie authentication.',
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
      security: [{}, { [cookieAuth.name]: [] }],
      description: 'Get a session by ID',
      request: {
        params: z.strictObject({
          id: z.string().describe('ID of the session to retrieve'),
        }),
        query: z.strictObject({ include: IncludesQuery }),
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
      security: [{}, { [cookieAuth.name]: [] }],
      description: 'Delete a session by ID',
      request: {
        params: z.strictObject({
          id: z.string().describe('ID of the session to remove'),
        }),
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
