import {
  atomicMediaType,
  getErrorDocumentSchema,
  getErrorSchema,
} from './jsonapi.ts';
import { LogResource, LogResourceIdentifier } from './log-schemas.ts';
import {
  RequestBodyTooLargeErrorResponse,
  RequestValidationErrorResponse,
} from './server-errors.ts';
import { z, type RouteConfig } from './zod-openapi.ts';

// JSON:API Atomic Operations extension, restricted to adding logs: this is how
// a client sends many logs in one request. Whether the operations all target
// the same run is checked by the server, not by these schemas.
const AddLogOperation = z
  .strictObject({ op: z.literal('add'), data: LogResource.omit({ id: true }) })
  .openapi('AddLogOperation');
const OperationsPostRequest = z
  .strictObject({ 'atomic:operations': z.array(AddLogOperation).min(1) })
  .openapi('OperationsPostRequest');
const OperationsPostResponse = z
  .strictObject({
    'atomic:results': z.array(z.strictObject({ data: LogResourceIdentifier })),
  })
  .openapi('OperationsPostResponse');

const operationPointer = z
  .strictObject({
    pointer: z
      .string()
      .describe('Pointer to the offending operation in the request body'),
  })
  .describe('Location of the error in the request body');

export const operationRoutes = {
  '/': {
    post: {
      description:
        'Create many logs of one run at once. All or nothing: if any operation fails, no log is created. A log the run already holds with the same number, type, and values succeeds like a new one and returns the stored id.',
      request: {
        body: {
          required: true,
          content: { [atomicMediaType]: { schema: OperationsPostRequest } },
        },
      },
      responses: {
        200: {
          description:
            'Logs stored, one result per operation and in the same order',
          content: { [atomicMediaType]: { schema: OperationsPostResponse } },
        },
        400: {
          description:
            'Invalid request: an operation that does not add a log, logs of several runs, the same log number twice, or an unsupported query parameter',
          content: {
            [atomicMediaType]: { schema: RequestValidationErrorResponse },
          },
        },
        403: {
          description: 'Forbidden',
          content: {
            [atomicMediaType]: {
              schema: getErrorDocumentSchema(
                getErrorSchema({
                  code: ['RUN_NOT_FOUND', 'INVALID_RUN_STATUS'],
                  statusCode: 403,
                }),
              ),
            },
          },
        },
        409: {
          description:
            'A log number exists in the run with different type or values',
          content: {
            [atomicMediaType]: {
              schema: getErrorDocumentSchema(
                z.strictObject({
                  ...getErrorSchema({
                    code: 'LOG_NUMBER_EXISTS',
                    statusCode: 409,
                  }).shape,
                  source: operationPointer,
                }),
              ),
            },
          },
        },
        413: {
          description: 'The request body is over the size limit (1 MB)',
          content: {
            [atomicMediaType]: { schema: RequestBodyTooLargeErrorResponse },
          },
        },
      },
    },
  },
} satisfies RouteConfig;
