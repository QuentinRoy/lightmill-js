import { getErrorDocumentSchema, getErrorSchema } from './jsonapi.ts';
import { z } from './zod-openapi.ts';

export const RequestValidationErrorResponse = getErrorDocumentSchema(
  z.union([
    getErrorSchema({ code: 'INVALID_REQUEST_BODY', statusCode: 400 })
      .extend({
        source: z.strictObject({
          pointer: z
            .string()
            .describe('Pointer to the invalid part of the request body'),
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
          header: z.string().describe('Header in the request that is invalid'),
        }),
      })
      .openapi('InvalidRequestHeadersError'),
  ]),
).openapi('ValidationErrorResponse');

export const NotFoundErrorResponse = getErrorDocumentSchema(
  getErrorSchema({ code: 'NOT_FOUND', statusCode: 404 }),
).openapi('NotFoundErrorResponse');

export const InternalServerErrorResponse = getErrorDocumentSchema(
  getErrorSchema({ code: 'INTERNAL_SERVER_ERROR', statusCode: 500 }),
).openapi('InternalServerErrorResponse');

export const MethodNotAllowedErrorResponse = getErrorDocumentSchema(
  getErrorSchema({ code: 'METHOD_NOT_ALLOWED', statusCode: 405 }),
).openapi('MethodNotAllowedErrorResponse');

export const UnsupportedMediaTypeErrorResponse = getErrorDocumentSchema(
  getErrorSchema({ code: 'UNSUPPORTED_MEDIA_TYPE', statusCode: 415 }),
).openapi('UnsupportedMediaTypeErrorResponse');

export const SessionRequiredErrorResponse = getErrorDocumentSchema(
  getErrorSchema({ code: 'SESSION_REQUIRED', statusCode: 403 }),
).openapi('SessionRequiredErrorResponse');

export const ServerErrorResponse = z
  .union([
    NotFoundErrorResponse,
    RequestValidationErrorResponse,
    InternalServerErrorResponse,
    MethodNotAllowedErrorResponse,
    UnsupportedMediaTypeErrorResponse,
    SessionRequiredErrorResponse,
  ])
  .openapi('ServerErrorResponse');
