import {
  getErrorSchema,
  getOneErrorDocumentSchema,
  mediaType,
} from './jsonapi.ts';
import { z } from './zod-openapi.ts';

// Responses
// -----------------------------------------------------------------------------
// These responses may be returned by the server at any time.
export const serverResponses = {
  400: {
    description: 'The request is invalid',
    content: {
      [mediaType]: {
        schema: getOneErrorDocumentSchema(
          z.union([
            getErrorSchema({ code: 'INVALID_REQUEST_BODY', statusCode: 400 })
              .extend({
                source: z.strictObject({
                  pointer: z
                    .string()
                    .describe(
                      'Pointer to the invalid part of the request body',
                    ),
                }),
              })
              .openapi('InvalidRequestBodyError'),
            getErrorSchema({ code: 'INVALID_REQUEST_QUERY', statusCode: 400 })
              .extend({
                source: z.strictObject({
                  parameter: z
                    .string()
                    .describe('Parameter in the request query that is invalid'),
                }),
              })
              .openapi('InvalidRequestQueryError'),
            getErrorSchema({ code: 'INVALID_REQUEST_HEADERS', statusCode: 400 })
              .extend({
                source: z.strictObject({
                  header: z
                    .string()
                    .describe('Header in the request that is invalid'),
                }),
              })
              .openapi('InvalidRequestHeadersError'),
          ]),
        ).openapi('BadRequestErrorResponse'),
      },
    },
  },
  403: {
    description: 'A session is required to access this resource',
    content: {
      [mediaType]: {
        schema: getOneErrorDocumentSchema(
          getErrorSchema({ code: 'SESSION_REQUIRED', statusCode: 403 }),
        ).openapi('ForbiddenErrorResponse'),
      },
    },
  },
  404: {
    description: 'Resource not found',
    content: {
      [mediaType]: {
        schema: getOneErrorDocumentSchema(
          getErrorSchema({ code: 'NOT_FOUND', statusCode: 404 }),
        ).openapi('NotFoundErrorResponse'),
      },
    },
  },
};

// Common types
export const StringOrArrayOfStrings = z
  .union([z.string(), z.array(z.string())])
  .openapi('StringOrArrayOfStrings');
