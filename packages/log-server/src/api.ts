import {
  httpStatuses,
  mediaType,
  type HttpStatusCode,
  type HttpStatusMap,
  type HttpStatusText,
} from '@lightmill/log-api/vocabulary';
import type { SessionData } from 'express-session';
import { groupBy, intersection, map, pipe, uniqueBy } from 'remeda';
import type { ConditionalKeys, JsonObject } from 'type-fest';
import type { DataStore, NewLog } from './data-store.ts';
import type { LogIntakeRejection } from './log-intake.ts';
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
    contentType: mediaType,
    status:
      statusCode ?? httpStatusCodeFromText<Error['status']>(firstError.status),
    body: { errors },
  };
}

/**
 * The error response to a log intake rejection. `source` gives the error
 * source of the offending log, for the rejections that name one.
 */
export function getLogIntakeErrorResponse<const Source extends object>(
  rejection: LogIntakeRejection,
  source: (index: number) => Source,
) {
  const { runId } = rejection;
  switch (rejection.code) {
    case 'RUN_NOT_FOUND':
      return getErrorResponse({
        status: 'Forbidden',
        code: rejection.code,
        detail: `Run "${runId}" not found`,
      });
    case 'INVALID_RUN_STATUS':
      return getErrorResponse({
        status: 'Forbidden',
        code: rejection.code,
        detail: `Cannot add logs to run '${runId}', run is not running. Ensure the run is running before adding logs.`,
      });
    case 'LOG_NUMBER_EXISTS':
      return getErrorResponse({
        status: 'Conflict',
        code: rejection.code,
        detail: `Cannot add logs to run '${runId}', log number ${rejection.number} already exists with a different type or values. Ensure log numbers are unique within the run.`,
        ...source(rejection.index),
      });
  }
}

/** The log a log resource of a request body describes. */
export function toNewLog({
  attributes,
}: {
  attributes: {
    number: number;
    logType: string;
    values: Record<string, unknown>;
  };
}): NewLog {
  return {
    number: attributes.number,
    type: attributes.logType,
    // values is necessarily a JsonObject since it's coming from the request
    // body.
    values: attributes.values as JsonObject,
  };
}

export async function getRunResources(
  store: DataStore,
  { filter }: { filter: Parameters<DataStore['getRuns']>[0] },
) {
  const runs = await store.getRuns(filter);
  const runIds = runs.map((run) => run.runId);
  const [experiments, lastLogs] = await Promise.all([
    store.getExperiments({
      experimentId: pipe(
        runs,
        uniqueBy((run) => run.experimentId),
        map((run) => run.experimentId),
      ),
    }),
    store.getLastLogs({ runId: runIds }),
  ]);
  const groupedLastLogs = groupBy(lastLogs, (log) => log.runId);

  return {
    runs: runs.map((run) => {
      const runLastLogs = groupedLastLogs[run.runId] ?? [];
      return {
        id: run.runId,
        type: 'runs' as const,
        attributes: {
          status: run.runStatus,
          name: run.runName,
          lastLogNumber: run.lastLogNumber,
          firstMissingLogNumber: run.firstMissingLogNumber,
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

/**
 * Whether a Content-Type header is the same JSON:API media type as `expected`:
 * same type, same extensions. JSON:API only allows the `ext` and `profile`
 * parameters, both quoted. A server may ignore profiles, so they are ignored.
 */
export function isContentType(header: string, expected: string) {
  const actual = parseJsonApiMediaType(header);
  const wanted = parseJsonApiMediaType(expected);
  return (
    actual != null &&
    wanted != null &&
    actual.type === wanted.type &&
    actual.extensions.join(' ') === wanted.extensions.join(' ')
  );
}

function parseJsonApiMediaType(value: string) {
  const parametersStart = value.indexOf(';');
  const type = (parametersStart < 0 ? value : value.slice(0, parametersStart))
    .trim()
    .toLowerCase();
  const parameters = parametersStart < 0 ? '' : value.slice(parametersStart);
  // Only `; name="quoted value"` pairs are valid, possibly none.
  if (!/^(\s*;\s*[\w-]+="[^"]*")*\s*$/.test(parameters)) return null;
  let extensions: string[] | undefined;
  // Each match captures a parameter's name, then its value without the quotes.
  for (const match of parameters.matchAll(/;\s*([\w-]+)="([^"]*)"/g)) {
    const name = match[1]?.toLowerCase();
    if (name === 'profile') continue;
    // Extension URIs are case-sensitive, unlike parameter names.
    if (name !== 'ext' || extensions != null) return null;
    extensions = (match[2] ?? '').split(' ').filter(Boolean).sort();
  }
  return { type, extensions: extensions ?? [] };
}

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

export type ReverseHttpStatusMap = {
  [Text in HttpStatusText]: ConditionalKeys<HttpStatusMap, Text>;
};
export type HttpStatusCodeFromText<Text extends HttpStatusText> =
  ReverseHttpStatusMap[Text];
export type HttpStatusTextFromCode<Code extends HttpStatusCode> =
  HttpStatusMap[Code];

export const httpMethods = ['get', 'post', 'put', 'patch', 'delete'] as const;
export type HttpMethod = (typeof httpMethods)[number];
