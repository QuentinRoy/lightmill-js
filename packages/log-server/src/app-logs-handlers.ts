import type { components, operations } from '@lightmill/log-api';
import { Readable } from 'node:stream';
import type { JsonObject } from 'type-fest';
import { parseAcceptHeader } from './accept-headers.ts';
import {
  apiMediaType,
  getAllowedAndFilteredRunIds,
  getErrorResponse,
  getRunResources,
  type ApiMediaType,
  type ServerHandlerResult,
  type SubServerDescription,
} from './app-utils.js';
import { csvExportStream } from './csv-export.js';
import type { AllFilter } from './data-filters.ts';
import { DataStoreError } from './data-store-errors.ts';
import type { DataStore } from './data-store.ts';
import { arrayify, firstStrict } from './utils.js';

export const logHandlers = (): SubServerDescription<'/logs'> => ({
  '/logs': {
    async get({
      request,
      store,
      parameters: { query, headers },
    }): Promise<ServerHandlerResult<'/logs', 'get'>> {
      let responseMimeType = getResponseMimeType(headers.accept, {
        defaultMimeType: 'csv',
      });
      let filter: AllFilter = {
        logType: query['filter[logType]'],
        runId: getAllowedAndFilteredRunIds(
          request.session.data,
          query['filter[run.id]'],
        ),
        experimentId: query['filter[experiment.id]'],
        experimentName: query['filter[experiment.name]'],
        runName: query['filter[run.name]'],
      };
      let includeQuery = arrayify(query['include'], true);
      if (responseMimeType === 'csv') {
        if (includeQuery.length > 0) {
          return getErrorResponse({
            status: 400,
            code: 'INVALID_QUERY_PARAMETER',
            detail: `CSV content does not support include query parameter`,
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
        contentType: apiMediaType,
      };
    },

    async post({ store, body, request }) {
      let runId = body.data.relationships.run.data.id;
      let runNotFoundError = getErrorResponse({
        status: 403,
        code: 'RUN_NOT_FOUND',
        detail: `Run "${runId}" not found`,
      });
      let sessionRuns = request.session.data?.runs ?? [];
      if (
        request.session.data?.role !== 'host' &&
        !sessionRuns.includes(runId)
      ) {
        return runNotFoundError;
      }
      let matchingRuns = await store.getRuns({ runId });
      if (matchingRuns.length > 1) {
        throw new Error(`Multiple runs found for id '${runId}'`);
      }
      let run = matchingRuns[0];
      if (run == null) return runNotFoundError;
      if (run.runStatus != 'running') {
        return getErrorResponse({
          status: 403,
          code: 'INVALID_RUN_STATUS',
          detail: `Cannot add logs to run '${runId}', run is not running`,
        });
      }
      try {
        let insertedLogId = firstStrict(
          await store.addLogs(run.runId, [
            {
              number: body.data.attributes.number,
              type: body.data.attributes.logType,
              // values is necessarily a JsonObject since it's coming from the request body.
              values: body.data.attributes.values as JsonObject,
            },
          ]),
        ).logId;
        return {
          status: 201,
          headers: {
            location: `${request.protocol + '://' + request.get('host')}/logs/${insertedLogId}`,
          },
          body: { data: { id: insertedLogId, type: 'logs' } },
        };
      } catch (e) {
        if (
          e instanceof DataStoreError &&
          e.code === 'LOG_NUMBER_EXISTS_IN_SEQUENCE'
        ) {
          return getErrorResponse({
            status: 409,
            code: 'LOG_NUMBER_EXISTS',
            detail: `Cannot add log to run '${runId}', log number ${body.data.attributes.number} already exists`,
          });
        }
        throw e;
      }
    },
  },

  '/logs/{id}': {
    async get({ request, store, parameters: { path, query } }) {
      let isHost = request.session.data?.role === 'host';
      let runFilter = isHost ? undefined : (request.session.data?.runs ?? []);
      let filter: AllFilter = { runId: runFilter, logId: path.id };
      let includeQuery = arrayify(query['include'], true);
      let dataString = '';
      for await (let chunk of jsonResponseChunkGenerator(store, filter, {
        run: includeQuery.includes('run') ?? false,
        experiment: includeQuery.includes('run.experiment') ?? false,
        lastLogs: includeQuery.includes('run.lastLogs') ?? false,
      })) {
        dataString += chunk;
      }
      let data = JSON.parse(
        dataString,
      ) as operations['Log_getCollection']['responses']['200']['content'][ApiMediaType];
      if (data.data.length > 1) {
        throw new Error(`More than one log found for id '${path.id}'`);
      }
      if (data.data.length === 0) {
        return getErrorResponse({
          status: 404,
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
function getResponseMimeType(
  acceptHeader: string | undefined,
  { defaultMimeType = 'json' }: GetResponseMimeTypeOptions = {},
): LogResponseMimeType {
  let format: LogResponseMimeType = defaultMimeType;
  if (acceptHeader != null) {
    const acceptHeaderParts = parseAcceptHeader(acceptHeader);
    for (let accept of acceptHeaderParts) {
      if (accept.type.includes('csv')) {
        format = 'csv';
        break;
      } else if (accept.type.includes('json')) {
        format = 'json';
        break;
      }
    }
  }
  return format;
}
type LogResponseMimeType = 'json' | 'csv';

function jsonResponseStream(
  store: DataStore,
  filter: Omit<AllFilter, 'runStatus'> = {},
  includes: { run?: boolean; experiment?: boolean; lastLogs?: boolean } = {},
): Readable {
  return Readable.from(jsonResponseChunkGenerator(store, filter, includes));
}

async function* jsonResponseChunkGenerator(
  store: DataStore,
  filter: Omit<AllFilter, 'runStatus'>,
  includes: { run?: boolean; experiment?: boolean; lastLogs?: boolean },
) {
  let runs = new Map<string, components['schemas']['Run.Resource'] | null>();
  let experiments = new Map<
    string,
    components['schemas']['Experiment.Resource']
  >();
  let includedLogs = new Array<components['schemas']['Log.Resource']>();
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
      } satisfies components['schemas']['Log.Resource'],
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
        ? await getRunResources(store, {
            runs: [
              {
                runId: log.runId,
                runStatus: log.runStatus,
                runName: log.runName,
                experimentId: log.experimentId,
              },
            ],
          })
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
