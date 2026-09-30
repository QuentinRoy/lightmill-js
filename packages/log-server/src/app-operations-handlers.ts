import type { JsonObject } from 'type-fest';
import { atomicMediaType, getErrorResponse } from './api.ts';
import { getRunAcceptingLogs } from './app-logs-handlers.ts';
import { DataStoreError } from './data-store-errors.ts';
import type { PathHandlers } from './router.ts';

// The route's response types require the extension's media type on every
// response. The router adds it to the errors it raises itself.
const inAtomic = <Response extends object>(response: Response) => ({
  ...response,
  contentType: atomicMediaType,
});

const pointerTo = (index: number, path: string) =>
  `/atomic:operations/${index}/data/${path}`;

const badRequest = (detail: string, pointer: string) =>
  inAtomic(
    getErrorResponse({
      status: 'Bad Request',
      code: 'INVALID_REQUEST_BODY',
      detail,
      source: { pointer },
    }),
  );

export const operationHandlers = (): PathHandlers<'/operations'> => ({
  '/operations': {
    async post({ dataStore: store, body, sessionData }) {
      const operations = body['atomic:operations'];
      const firstOperation = operations[0];
      // The request schema requires at least one operation.
      if (firstOperation == null) {
        throw new TypeError('Expected at least one operation');
      }
      const runId = firstOperation.data.relationships.run.data.id;
      const seenNumbers = new Set<number>();
      for (const [index, { data }] of operations.entries()) {
        if (data.relationships.run.data.id !== runId) {
          return badRequest(
            `All operations must add logs to the same run ("${runId}").`,
            pointerTo(index, 'relationships/run/data/id'),
          );
        }
        if (seenNumbers.has(data.attributes.number)) {
          return badRequest(
            `Log number ${data.attributes.number} appears more than once in the request.`,
            pointerTo(index, 'attributes/number'),
          );
        }
        seenNumbers.add(data.attributes.number);
      }

      const runOrError = await getRunAcceptingLogs(store, sessionData, runId);
      if ('error' in runOrError) {
        return inAtomic(runOrError.error);
      }
      const { run } = runOrError;

      try {
        const results = await store.addLogs(
          run.runId,
          operations.map(({ data }) => ({
            number: data.attributes.number,
            type: data.attributes.logType,
            // values is necessarily a JsonObject since it's coming from the
            // request body.
            values: data.attributes.values as JsonObject,
          })),
        );
        return {
          contentType: atomicMediaType,
          body: {
            'atomic:results': results.map(({ logId }) => ({
              data: { id: logId, type: 'logs' as const },
            })),
          },
        };
      } catch (e) {
        if (
          e instanceof DataStoreError &&
          e.code === 'LOG_NUMBER_EXISTS_IN_SEQUENCE'
        ) {
          const index = operations.findIndex(
            ({ data }) => data.attributes.number === e.logNumber,
          );
          return inAtomic(
            getErrorResponse({
              status: 'Conflict',
              code: 'LOG_NUMBER_EXISTS',
              detail: `Cannot add logs to run '${runId}', log number ${e.logNumber} already exists with a different type or values. Ensure log numbers are unique within the run.`,
              source: {
                pointer:
                  index < 0
                    ? '/atomic:operations'
                    : pointerTo(index, 'attributes/number'),
              },
            }),
          );
        }
        throw e;
      }
    },
  },
});
