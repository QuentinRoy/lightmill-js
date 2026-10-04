import { atomicMediaType } from '@lightmill/log-api/vocabulary';
import {
  getErrorResponse,
  getLogIntakeErrorResponse,
  toNewLog,
} from './api.ts';
import { addLogsToWritableRun } from './log-intake.ts';
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

      const outcome = await addLogsToWritableRun(
        store,
        sessionData,
        runId,
        operations.map(({ data }) => toNewLog(data)),
      );
      if ('rejection' in outcome) {
        return inAtomic(
          getLogIntakeErrorResponse(outcome.rejection, (index) => ({
            source: { pointer: pointerTo(index, 'attributes/number') },
          })),
        );
      }
      return {
        status: 200,
        contentType: atomicMediaType,
        body: {
          'atomic:results': outcome.results.map(({ logId }) => ({
            data: { id: logId, type: 'logs' as const },
          })),
        },
      };
    },
  },
});
