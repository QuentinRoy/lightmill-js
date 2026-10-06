import { mediaType } from '@lightmill/log-api/vocabulary';
import { parseAcceptHeader } from './accept-headers.ts';
import { visibleRunIds } from './access.ts';
import { toNewLog } from './api.ts';
import { csvExportStream } from './csv-export.ts';
import type { AllFilter } from './data-filters.ts';
import {
  getErrorResponse,
  getLogDocument,
  getLogIntakeError,
  getLogsDocumentStream,
} from './json-api.ts';
import { addLogsToWritableRun } from './log-intake.ts';
import type {
  HandlerResponseFromRoute,
  PathHandlers,
} from './request-handling.ts';
import { arrayify, firstStrict } from './utils.ts';

export const createLogHandlers = (): PathHandlers<'/logs'> => ({
  '/logs': {
    async get({
      sessionData,
      dataStore: store,
      parameters: { query, headers },
    }): Promise<HandlerResponseFromRoute<'/logs', 'get'>> {
      let responseMimeType = getResponseMimeType(headers.accept, {
        defaultMimeType: 'csv',
      });
      let filter: AllFilter = {
        logType: query['filter[logType]'],
        runId: visibleRunIds(sessionData, query['filter[run.id]']),
        experimentId: query['filter[experiment.id]'],
        experimentName: query['filter[experiment.name]'],
        runName: query['filter[run.name]'],
      };
      if (responseMimeType === 'csv') {
        if (arrayify(query['include'], true).length > 0) {
          return getErrorResponse({
            status: 'Bad Request',
            code: 'NOT_SUPPORTED_QUERY_PARAMETER',
            detail:
              `Include query parameter is not supported with CSV log format.` +
              ` Remove the 'include' query parameter, or set 'accept' header to '${mediaType}' to get logs in JSON format.`,
            source: { parameter: 'include' },
          });
        }
        return {
          status: 200,
          contentType: 'text/csv',
          body: csvExportStream(store, filter),
        };
      }

      return {
        status: 200,
        body: getLogsDocumentStream(store, filter, query['include']),
        contentType: mediaType,
      };
    },

    async post({
      dataStore: store,
      body,
      sessionData,
      protocol,
      host,
      baseUrl,
    }) {
      let outcome = await addLogsToWritableRun(
        store,
        sessionData,
        body.data.relationships.run.data.id,
        [toNewLog(body.data)],
      );
      if ('rejection' in outcome) {
        return getErrorResponse(
          getLogIntakeError(outcome.rejection, () => ({})),
        );
      }
      let { logId: insertedLogId, created } = firstStrict(outcome.results);
      return {
        // Nothing was created for a duplicate log (a resend).
        status: created ? 201 : 200,
        headers: {
          location: `${protocol + '://' + host + baseUrl}/logs/${insertedLogId}`,
        },
        body: { data: { id: insertedLogId, type: 'logs' } },
      };
    },
  },

  '/logs/{id}': {
    async get({ sessionData, dataStore: store, parameters: { path, query } }) {
      let filter: AllFilter = {
        runId: visibleRunIds(sessionData, undefined),
        logId: path.id,
      };
      let document = await getLogDocument(store, filter, query['include']);
      if (document == null) {
        return getErrorResponse({
          status: 'Not Found',
          code: 'LOG_NOT_FOUND',
          detail: `Log "${path.id}" not found`,
        });
      }
      return { status: 200, body: document };
    },
  },
});

interface GetResponseMimeTypeOptions {
  defaultMimeType?: LogResponseMimeType;
}
type LogResponseMimeType = 'json' | 'csv';
function getResponseMimeType(
  acceptHeader: string | undefined,
  { defaultMimeType = 'json' }: GetResponseMimeTypeOptions = {},
): LogResponseMimeType {
  if (acceptHeader != null) {
    const acceptHeaderParts = parseAcceptHeader(acceptHeader);
    for (let accept of acceptHeaderParts) {
      if (accept.type.includes('csv')) {
        return 'csv';
      } else if (accept.type.includes('json')) {
        return 'json';
      }
    }
  }
  return defaultMimeType;
}
