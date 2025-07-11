import { getErrorSchema, getOneErrorDocumentSchema } from './jsonapi.ts';
import { z } from './zod-openapi.ts';

export const BadRequestErrorResponse = getOneErrorDocumentSchema(
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
).openapi('BadRequestErrorResponse');

export const NotFoundErrorResponse = getOneErrorDocumentSchema(
  getErrorSchema({ code: 'NOT_FOUND', statusCode: 404 }),
).openapi('NotFoundErrorResponse');

export const InternalServerErrorResponse = getOneErrorDocumentSchema(
  getErrorSchema({ code: 'INTERNAL_SERVER_ERROR', statusCode: 500 }),
).openapi('InternalServerErrorResponse');

export const MethodNotAllowedErrorResponse = getOneErrorDocumentSchema(
  getErrorSchema({ code: 'METHOD_NOT_ALLOWED', statusCode: 405 }),
).openapi('MethodNotAllowedErrorResponse');

export const UnsupportedMediaTypeErrorResponse = getOneErrorDocumentSchema(
  getErrorSchema({ code: 'UNSUPPORTED_MEDIA_TYPE', statusCode: 415 }),
).openapi('UnsupportedMediaTypeErrorResponse');

export const SessionRequiredErrorResponse = getOneErrorDocumentSchema(
  getErrorSchema({ code: 'SESSION_REQUIRED', statusCode: 403 }),
).openapi('SessionRequiredErrorResponse');

export const ServerErrorResponse = z
  .union([
    NotFoundErrorResponse,
    BadRequestErrorResponse,
    InternalServerErrorResponse,
    MethodNotAllowedErrorResponse,
    UnsupportedMediaTypeErrorResponse,
    SessionRequiredErrorResponse,
  ])
  .openapi('ServerErrorResponse');
