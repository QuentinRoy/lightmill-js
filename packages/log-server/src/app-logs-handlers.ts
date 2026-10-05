import type { routes } from '@lightmill/log-api';
import { mediaType } from '@lightmill/log-api/vocabulary';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { Readable } from 'node:stream';
import { parseAcceptHeader } from './accept-headers.ts';
import { visibleRunIds } from './access.ts';
import {
  getErrorResponse,
  getLogIntakeErrorResponse,
  getRunResources,
  toNewLog,
} from './api.ts';
import { csvExportStream } from './csv-export.ts';
import type { AllFilter } from './data-filters.ts';
import type { DataStore } from './data-store.ts';
import { addLogsToWritableRun } from './log-intake.ts';
import type { HandlerResponseFromRoute, PathHandlers } from './router.ts';
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
      let includeQuery = arrayify(query['include'], true);
      if (responseMimeType === 'csv') {
        if (includeQuery.length > 0) {
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
        body: jsonResponseStream(store, filter, {
          run: includeQuery.includes('run'),
          experiment: includeQuery.includes('run.experiment'),
          lastLogs: includeQuery.includes('run.lastLogs'),
        }),
        contentType: mediaType,
      };
    },

    async post({ dataStore: store, body, sessionData, protocol, host }) {
      let outcome = await addLogsToWritableRun(
        store,
        sessionData,
        body.data.relationships.run.data.id,
        [toNewLog(body.data)],
      );
      if ('rejection' in outcome) {
        return getLogIntakeErrorResponse(outcome.rejection, () => ({}));
      }
      let { logId: insertedLogId, created } = firstStrict(outcome.results);
      return {
        // Nothing was created for a duplicate log (a resend).
        status: created ? 201 : 200,
        headers: {
          location: `${protocol + '://' + host}/logs/${insertedLogId}`,
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
      let includeQuery = arrayify(query['include'], true);
      let dataString = '';
      for await (let chunk of jsonResponseChunkGenerator(store, filter, {
        run: includeQuery.includes('run') ?? false,
        experiment: includeQuery.includes('run.experiment') ?? false,
        lastLogs: includeQuery.includes('run.lastLogs') ?? false,
      })) {
        dataString += chunk;
      }
      let data = JSON.parse(dataString);
      if (data.data.length > 1) {
        throw new Error(`More than one log found for id '${path.id}'`);
      }
      if (data.data.length === 0) {
        return getErrorResponse({
          status: 'Not Found',
          code: 'LOG_NOT_FOUND',
          detail: `Log "${path.id}" not found`,
        });
      }
      return {
        status: 200,
        body: { data: firstStrict(data.data) },
        included: data.included,
      };
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

function jsonResponseStream(
  store: DataStore,
  filter: Omit<AllFilter, 'runStatus'> = {},
  includes: { run?: boolean; experiment?: boolean; lastLogs?: boolean } = {},
): Readable {
  return Readable.from(jsonResponseChunkGenerator(store, filter, includes));
}

type RunResource = StandardSchemaV1.InferOutput<
  (typeof routes)['/runs/{id}']['get']['responses'][200]['content'][typeof mediaType]['schema']
>['data'];
type ExperimentResource = StandardSchemaV1.InferOutput<
  (typeof routes)['/experiments/{id}']['get']['responses'][200]['content'][typeof mediaType]['schema']
>['data'];
type LogResource = StandardSchemaV1.InferOutput<
  (typeof routes)['/logs/{id}']['get']['responses'][200]['content'][typeof mediaType]['schema']
>['data'];

async function* jsonResponseChunkGenerator(
  store: DataStore,
  filter: Omit<AllFilter, 'runStatus'>,
  includes: { run?: boolean; experiment?: boolean; lastLogs?: boolean },
) {
  let runs = new Map<string, RunResource | null>();
  let experiments = new Map<string, ExperimentResource | null>();
  let includedLogs = new Array<LogResource>();
  let logs = await store.getLogs({ ...filter, runStatus: '-canceled' });
  yield '{"data":[';
  let started = false;
  for await (let log of logs) {
    yield started ? ',\n' : '\n';
    started = true;
    yield JSON.stringify(
      {
        type: 'logs',
        id: log.logId,
        attributes: {
          logType: log.type,
          number: log.number,
          values: log.values,
        },
        relationships: { run: { data: { type: 'runs', id: log.runId } } },
      } satisfies LogResource,
      stringifyDateSerializer,
    );
    if (
      (!includes.run && !includes.experiment && !includes.lastLogs) ||
      runs.has(log.runId)
    ) {
      continue;
    }
    let runResources =
      includes.run || includes.lastLogs
        ? await getRunResources(store, { filter: { runId: log.runId } })
        : { runs: [], experiments: [], lastLogs: [] };

    if (includes.run) {
      runs.set(log.runId, firstStrict(runResources.runs));
    } else {
      // We won't include the run resource in the response, but we still need to
      // remember that we have seen it, so we don't process this again.
      runs.set(log.runId, null);
    }
    if (includes.lastLogs) {
      includedLogs.push(...runResources.lastLogs);
    }
    if (!includes.experiment) continue;
    let experiment = experiments.get(log.experimentId);
    if (experiment == null) {
      experiment = {
        type: 'experiments',
        id: log.experimentId,
        attributes: { name: log.experimentName },
      };
      experiments.set(log.experimentId, experiment);
    }
  }
  if (!includes.run && !includes.experiment && !includes.lastLogs) {
    yield '\n]}';
    return;
  }
  yield '],\n"included":[';
  started = false;
  for (let value of [
    ...experiments.values(),
    ...runs.values(),
    ...includedLogs,
  ]) {
    if (value == null) continue;
    yield started ? ',\n' : '\n';
    started = true;
    yield JSON.stringify(value, stringifyDateSerializer);
  }
  yield '\n]}';
}

function stringifyDateSerializer(_key: string, value: unknown) {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return value;
}
