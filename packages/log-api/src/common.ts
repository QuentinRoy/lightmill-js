import {
  getErrorSchema,
  getOneErrorDocumentSchema,
  mediaType,
} from './jsonapi.ts';
import { z } from './zod-openapi.ts';

// Error schemas
// -----------------------------------------------------------------------------
export const forbiddenErrorHttpCode = 403 as const;
export const ForbiddenError = getErrorSchema({
  code: 'FORBIDDEN',
  statusCode: forbiddenErrorHttpCode,
}).openapi('ForbiddenError');
const loginRequiredErrorHttpCode = 403 as const;
export const SessionRequiredError = getErrorSchema({
  code: 'SESSION_REQUIRED',
  statusCode: loginRequiredErrorHttpCode,
}).openapi('SessionRequiredError');

// Response schemas
// -----------------------------------------------------------------------------
export const ForbiddenErrorResponse = getOneErrorDocumentSchema(
  ForbiddenError,
).openapi('ForbiddenErrorResponse');
export const SessionRequiredErrorResponse = getOneErrorDocumentSchema(
  SessionRequiredError,
).openapi('SessionRequiredErrorResponse');

// Responses
// -----------------------------------------------------------------------------
export const forbiddenResponse = {
  [forbiddenErrorHttpCode]: {
    description: 'Forbidden',
    content: { [mediaType]: { schema: ForbiddenErrorResponse } },
  },
};
export const loginRequiredResponse = {
  [loginRequiredErrorHttpCode]: {
    description: 'Login required',
    content: { [mediaType]: { schema: SessionRequiredErrorResponse } },
  },
};

// Common types
export const StringOrArrayOfStrings = z
  .union([z.string(), z.array(z.string())])
  .openapi('StringOrArrayOfStrings');
