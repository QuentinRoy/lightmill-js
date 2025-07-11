import type { SessionData } from 'express-session';
import { groupBy, intersection, map, pipe, uniqueBy } from 'remeda';
import type { ConditionalKeys } from 'type-fest';
import type { DataStore } from './data-store.ts';
import { arrayify } from './utils.ts';

export function getErrorResponse<
  const Error extends { code: string; status: HttpStatusText },
>(
  errors: Array<Error> | Error,
  statusCode?: HttpStatusCodeFromText<Error['status']>,
) {
  errors = Array.isArray(errors) ? errors : [errors];
  let firstError = errors[0];
  if (firstError == null) {
    throw new Error('No errors provided');
  }
  return {
    contentType: apiMediaType,
    status:
      statusCode ?? httpStatusCodeFromText<Error['status']>(firstError.status),
    body: { errors },
  };
}

type GetRunResourcesOptions =
  | { filter: Parameters<DataStore['getRuns']>[0] }
  | {
      runs: Omit<
        Awaited<ReturnType<DataStore['getRuns']>>[number],
        'runCreatedAt'
      >[];
    };
export async function getRunResources(
  store: DataStore,
  options: GetRunResourcesOptions,
) {
  const runs =
    'runs' in options ? options.runs : await store.getRuns(options.filter);
  const runIds = runs.map((run) => run.runId);
  const [experiments, lastLogs, missingLogs] = await Promise.all([
    store.getExperiments({
      experimentId: pipe(
        runs,
        uniqueBy((run) => run.experimentId),
        map((run) => run.experimentId),
      ),
    }),
    store.getLastLogs({ runId: runIds }),
    store.getMissingLogs({ runId: runIds }),
  ]);
  const groupedLastLogs = groupBy(lastLogs, (log) => log.runId);
  const groupedMissingLogs = groupBy(missingLogs, (log) => log.runId);

  return {
    runs: runs.map((run) => {
      const runLastLogs = groupedLastLogs[run.runId] ?? [];
      return {
        id: run.runId,
        type: 'runs' as const,
        attributes: {
          status: run.runStatus,
          name: run.runName,
          lastLogNumber: Math.max(0, ...runLastLogs.map((l) => l.number)),
          missingLogNumbers:
            groupedMissingLogs[run.runId]?.map((l) => l.logNumber) ?? [],
        },
        relationships: {
          lastLogs: {
            data: runLastLogs.map((log) => ({
              id: log.logId,
              type: 'logs' as const,
            })),
          },
          experiment: {
            data: { id: run.experimentId, type: 'experiments' as const },
          },
        },
      };
    }),
    experiments: experiments.map((experiment) => ({
      id: experiment.experimentId,
      type: 'experiments' as const,
      attributes: { name: experiment.experimentName },
    })),
    lastLogs: lastLogs.map((log) => ({
      id: log.logId,
      type: 'logs' as const,
      attributes: { number: log.number, logType: log.type, values: log.values },
      relationships: {
        run: { data: { id: log.runId, type: 'runs' as const } },
      },
    })),
  };
}

export function getAllowedAndFilteredRunIds(
  sessionData: SessionData['data'] | undefined,
  queryFilter: undefined | string | string[],
) {
  if (sessionData == null) {
    return [];
  }
  if (sessionData.role === 'host') {
    return queryFilter;
  }
  if (queryFilter == null) {
    return sessionData.runs;
  }
  return intersection(sessionData.runs, arrayify(queryFilter, true));
}

export const apiMediaType = 'application/vnd.api+json' as const;
export type ApiMediaType = typeof apiMediaType;

export function parseCookies(cookieHeader: string | undefined) {
  if (cookieHeader == null) return {};
  return Object.fromEntries(
    cookieHeader.split(';').map((cookie) => {
      const [key, value] = cookie
        .split('=')
        .map((part) => decodeURIComponent(part.trim()));
      if (key == null || value == null) {
        throw new Error(
          `Invalid cookie format: "${cookie}". Expected "key=value" format.`,
        );
      }
      return [key, value];
    }),
  );
}

export const httpStatuses = {
  200: 'OK',
  201: 'Created',
  202: 'Accepted',
  204: 'No Content',
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  406: 'Not Acceptable',
  409: 'Conflict',
  415: 'Unsupported Media Type',
  500: 'Internal Server Error',
} as const;
export const reverseHttpStatuses = Object.fromEntries(
  Object.entries(httpStatuses).map(([code, text]) => [text, Number(code)]),
) as ReverseHttpStatusMap;

export function httpStatusCodeFromText<const Text extends HttpStatusText>(
  status: Text,
): HttpStatusCodeFromText<Text> {
  return reverseHttpStatuses[status];
}

export function httpStatusTextFromCode<Code extends HttpStatusCode>(
  status: Code,
): HttpStatusTextFromCode<Code> {
  return httpStatuses[status];
}

export type HttpStatusMap = typeof httpStatuses;
export type ReverseHttpStatusMap = {
  [Text in HttpStatusText]: ConditionalKeys<HttpStatusMap, Text>;
};
export type HttpStatusCodeFromText<Text extends HttpStatusText> =
  ReverseHttpStatusMap[Text];
export type HttpStatusTextFromCode<Code extends HttpStatusCode> =
  HttpStatusMap[Code];
export type HttpStatusCode = keyof HttpStatusMap;
export type HttpStatusText = HttpStatusMap[HttpStatusCode];

export type UserRole = 'host' | 'participant';

export const httpMethods = ['get', 'post', 'put', 'patch', 'delete'] as const;
export type HttpMethod = (typeof httpMethods)[number];
