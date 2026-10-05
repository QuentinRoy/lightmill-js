import * as LogApi from '@lightmill/log-api';
import {
  atomicMediaType,
  mediaType,
  type HttpStatusText,
  type UserRole,
} from '@lightmill/log-api/vocabulary';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { Readable } from 'node:stream';
import { chunk, groupBy, map, pipe, uniqueBy } from 'remeda';
import { httpStatusCodeFromText, type HttpStatusCodeFromText } from './api.ts';
import type { AllFilter, ExperimentFilter } from './data-filters.ts';
import type {
  DataStore,
  ExperimentId,
  ExperimentRecord,
  Log,
  LogId,
  RunId,
} from './data-store.ts';
import type { LogIntakeRejection } from './log-intake.ts';
import { arrayify, fromAsync } from './utils.ts';

// Everything the server answers with that is shaped by JSON:API lives here:
// error documents, the resources and documents built from the store's
// records, and the media type of each route's responses. Handlers pick a
// document and pass the request's `include` through.

// A route accepts a single request media type: the plain one unless its body
// is declared with another (the atomic operations extension).
// The index signature lets routes without a body match: TypeScript rejects
// them otherwise, for sharing no property with an all-optional type.
export type RouteWithBody = {
  request: { body?: { content: object }; [key: string]: unknown };
};

export function getRequestMediaType(route: RouteWithBody) {
  return route.request.body != null &&
    atomicMediaType in route.request.body.content
    ? atomicMediaType
    : mediaType;
}
export type RouteMediaType = ReturnType<typeof getRequestMediaType>;

const routes: Record<string, Record<string, RouteWithBody>> = LogApi.routes;
const methodsByLowerCasePath = new Map(
  Object.entries(routes).map(
    ([path, methods]): [string, Record<string, RouteWithBody>] => [
      path.toLowerCase(),
      methods,
    ],
  ),
);

/**
 * The media type the server answers with on `path`, for responses that are
 * not tied to one of its routes: a method it does not have, or an error of
 * the body parser, which runs before routing.
 */
export function getResponseMediaType(path: string) {
  // Express matches a path in any case, with or without a trailing slash.
  const methods = methodsByLowerCasePath.get(
    path.replace(/\/+$/, '').toLowerCase(),
  );
  return methods != null &&
    Object.values(methods).some(
      (route) => getRequestMediaType(route) === atomicMediaType,
    )
    ? atomicMediaType
    : mediaType;
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

type ErrorLike = { code: string; status: HttpStatusText };

type ErrorResponse<Error extends ErrorLike, ContentType extends string> = {
  contentType: ContentType;
  status: HttpStatusCodeFromText<Error['status']>;
  body: { errors: Array<Error> };
};

// One response per error of a union: the status of a response goes with the
// errors its body lists.
type SingleErrorResponse<
  Error extends ErrorLike,
  ContentType extends string,
> = Error extends ErrorLike ? ErrorResponse<Error, ContentType> : never;

/**
 * The response to a request that failed. The media type is the caller's to
 * give: a handler passes its route's if it is not the plain one, and the
 * router passes the route's for the errors it raises itself.
 */
export function getErrorResponse<const Error extends ErrorLike>(
  error: Error,
): SingleErrorResponse<Error, typeof mediaType>;
export function getErrorResponse<
  const Error extends ErrorLike,
  const ContentType extends string,
>(
  error: Error,
  contentType: ContentType,
): SingleErrorResponse<Error, ContentType>;
export function getErrorResponse<
  const Error extends ErrorLike,
  const ContentType extends string,
>(
  errors: Array<Error>,
  contentType: ContentType,
): ErrorResponse<Error, ContentType>;
export function getErrorResponse(
  errors: ErrorLike | Array<ErrorLike>,
  contentType: string = mediaType,
): ErrorResponse<ErrorLike, string> {
  const errorList = Array.isArray(errors) ? errors : [errors];
  const firstError = errorList[0];
  if (firstError == null) {
    throw new Error('No errors provided');
  }
  return {
    contentType,
    status: httpStatusCodeFromText(firstError.status),
    body: { errors: errorList },
  };
}

type ErrorOf<Response extends StandardSchemaV1> =
  StandardSchemaV1.InferOutput<Response> extends { errors: Array<infer E> }
    ? E
    : never;

/**
 * The error for a log intake rejection. `source` gives the error source of
 * the offending log, for the rejections that name one.
 */
export function getLogIntakeError<const Source extends object>(
  rejection: LogIntakeRejection,
  source: (index: number) => Source,
) {
  const { runId } = rejection;
  switch (rejection.code) {
    case 'RUN_NOT_FOUND':
      return {
        status: 'Forbidden',
        code: rejection.code,
        detail: `Run "${runId}" not found`,
      } as const;
    case 'RUN_NOT_OWNED':
      return getRunNotOwnedError(runId);
    case 'INVALID_RUN_STATUS':
      return {
        status: 'Forbidden',
        code: rejection.code,
        detail: `Cannot add logs to run '${runId}', run is not running. Ensure the run is running before adding logs.`,
      } as const;
    case 'LOG_NUMBER_EXISTS':
      return {
        status: 'Conflict',
        code: rejection.code,
        detail: `Cannot add logs to run '${runId}', log number ${rejection.number} already exists with a different type or values. Ensure log numbers are unique within the run.`,
        ...source(rejection.index),
      } as const;
  }
}

export const getRunNotOwnedError = (runId: string) =>
  ({
    status: 'Forbidden',
    code: 'RUN_NOT_OWNED',
    detail: `Run "${runId}" belongs to another session. Only the session that created a run can write to it.`,
  }) as const;

export const sessionRequiredError = {
  status: 'Forbidden',
  code: 'SESSION_REQUIRED',
  detail: 'A session is required. Post to /sessions to create one.',
} as const;

export const getInternalServerError = (error: Error) =>
  ({
    status: 'Internal Server Error',
    code: 'INTERNAL_SERVER_ERROR',
    detail: error.message,
  }) as const satisfies ErrorOf<typeof LogApi.InternalServerErrorResponse>;

// Body-parser errors are the client's: answering them with a 500 would make
// log-client retry a request that can never succeed.
export function getBodyParserError(err: Error, requestBodyLimit: string) {
  // body-parser throws http-errors: `status` is 4xx for what the client got
  // wrong, `type` names it.
  const status =
    'status' in err && typeof err.status === 'number' ? err.status : 0;
  if (status < 400 || status >= 500) return null;
  const type = 'type' in err ? err.type : undefined;
  if (type === 'entity.too.large') {
    return {
      status: 'Payload Too Large',
      code: 'REQUEST_BODY_TOO_LARGE',
      detail: `Request body must not exceed ${requestBodyLimit}.`,
    } as const satisfies ErrorOf<
      typeof LogApi.RequestBodyTooLargeErrorResponse
    >;
  }
  if (status === 415) {
    // An encoding or charset body-parser cannot decode.
    return {
      status: 'Unsupported Media Type',
      code: 'UNSUPPORTED_MEDIA_TYPE',
      detail: err.message,
    } as const satisfies ErrorOf<
      typeof LogApi.UnsupportedMediaTypeErrorResponse
    >;
  }
  // Malformed JSON, aborted request, wrong length: nothing to retry either.
  return {
    status: 'Bad Request',
    code: 'INVALID_REQUEST_BODY',
    // No `source`: a pointer must reference a value of the request
    // document, and there is no document.
    detail: err.message,
  } as const satisfies ErrorOf<typeof LogApi.RequestValidationErrorResponse>;
}

const experimentResource = (experiment: ExperimentRecord) => ({
  id: experiment.experimentId,
  type: 'experiments' as const,
  attributes: { name: experiment.experimentName },
});

const logResource = (
  log: Pick<Log, 'logId' | 'runId' | 'type' | 'number' | 'values'>,
) => ({
  type: 'logs' as const,
  id: log.logId,
  attributes: { logType: log.type, number: log.number, values: log.values },
  relationships: { run: { data: { type: 'runs' as const, id: log.runId } } },
});

/**
 * The runs matching `filter`, with the resources a run document may include:
 * their experiments and their last logs. A run's resource always lists its
 * last logs, so these are looked up for every run; a lookup covers all runs
 * at once.
 */
async function getRunResources(
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
    experiments: experiments.map(experimentResource),
    lastLogs: lastLogs.map(logResource),
  };
}
type RunResources = Awaited<ReturnType<typeof getRunResources>>;

// What each route's `include` names stand for. A nested name stands for every
// resource on its path: the experiments of `runs.experiment` are only linked
// from their runs, and a compound document must hold what it links to.
const runIncludes = {
  experiment: ['experiments'],
  lastLogs: ['lastLogs'],
} as const;
const sessionIncludes = {
  runs: ['runs'],
  'runs.experiment': ['runs', 'experiments'],
  'runs.lastLogs': ['runs', 'lastLogs'],
} as const;
const logIncludes = {
  run: ['runs'],
  'run.experiment': ['runs', 'experiments'],
  'run.lastLogs': ['runs', 'lastLogs'],
} as const;

// The order of the included resources in a document.
const includedKindOrder = [
  'runs',
  'experiments',
  'lastLogs',
] as const satisfies ReadonlyArray<keyof RunResources>;

type IncludeQuery<Names extends Record<string, unknown>> =
  keyof Names | ReadonlyArray<keyof Names> | undefined;

function getIncludedKinds<
  const Names extends Record<string, ReadonlyArray<keyof RunResources>>,
>(
  names: Names,
  include: IncludeQuery<NoInfer<Names>>,
): Array<Names[keyof Names][number]> {
  const requested: Array<keyof Names> = arrayify(include, true);
  const kinds = new Set<keyof RunResources>(
    requested.flatMap((name) => names[name]),
  );
  return includedKindOrder.filter((kind): kind is Names[keyof Names][number] =>
    kinds.has(kind),
  );
}

/** A document, with `included` only if some resources were requested. */
function withIncluded<Data, Kind extends keyof RunResources>(
  data: Data,
  resources: RunResources,
  kinds: Kind[],
): { data: Data; included?: Array<RunResources[Kind][number]> } {
  if (kinds.length === 0) return { data };
  const included: Array<RunResources[Kind][number]> = [];
  for (const kind of kinds) included.push(...resources[kind]);
  return { data, included };
}

const noRunResources: RunResources = {
  runs: [],
  experiments: [],
  lastLogs: [],
};

export async function getExperimentsDocument(
  store: DataStore,
  filter: ExperimentFilter,
) {
  const experiments = await store.getExperiments(filter);
  return { data: experiments.map(experimentResource) };
}

export async function getExperimentDocument(
  store: DataStore,
  experimentId: ExperimentId,
) {
  const experiments = await store.getExperiments({ experimentId });
  if (experiments.length > 1) {
    // This should not happen, but we handle it gracefully.
    throw new Error('Multiple experiments found for the given ID');
  }
  const experiment = experiments[0];
  return experiment == null
    ? undefined
    : { data: experimentResource(experiment) };
}

export async function getRunsDocument(
  store: DataStore,
  filter: Parameters<DataStore['getRuns']>[0],
  include: IncludeQuery<typeof runIncludes>,
) {
  const resources = await getRunResources(store, { filter });
  return withIncluded(
    resources.runs,
    resources,
    getIncludedKinds(runIncludes, include),
  );
}

/** The run's document, or undefined if there is no such run. */
export async function getRunDocument(
  store: DataStore,
  runId: RunId,
  include?: IncludeQuery<typeof runIncludes>,
) {
  const resources = await getRunResources(store, { filter: { runId } });
  const run = resources.runs[0];
  if (run === undefined) return undefined;
  return withIncluded(run, resources, getIncludedKinds(runIncludes, include));
}

export async function getSessionDocument(
  store: DataStore,
  sessionData: { runs: RunId[]; role: UserRole },
  include?: IncludeQuery<typeof sessionIncludes>,
) {
  const kinds = getIncludedKinds(sessionIncludes, include);
  const resources = await getIncludedRunResources(
    store,
    sessionData.runs,
    kinds,
  );
  return withIncluded(
    {
      type: 'sessions' as const,
      id: 'current' as const,
      attributes: { role: sessionData.role },
      relationships: {
        runs: {
          data: sessionData.runs.map((runId) => ({
            type: 'runs' as const,
            id: runId,
          })),
        },
      },
    },
    resources,
    kinds,
  );
}

/**
 * The logs matching `filter`, as a document streamed log by log. The included
 * resources come after the logs, from a single lookup of all their runs.
 */
export function getLogsDocumentStream(
  store: DataStore,
  filter: Omit<AllFilter, 'runStatus'>,
  include: IncludeQuery<typeof logIncludes>,
) {
  return Readable.from(
    logsDocumentChunks(store, filter, getIncludedKinds(logIncludes, include)),
  );
}

async function* logsDocumentChunks(
  store: DataStore,
  filter: Omit<AllFilter, 'runStatus'>,
  kinds: Array<keyof RunResources>,
) {
  const runIds = new Set<RunId>();
  yield '{"data":[';
  let started = false;
  for await (const log of store.getLogs({
    ...filter,
    runStatus: '-canceled',
  })) {
    yield started ? ',\n' : '\n';
    started = true;
    yield JSON.stringify(logResource(log));
    runIds.add(log.runId);
  }
  if (kinds.length === 0) {
    yield '\n]}';
    return;
  }
  const runResources = await getIncludedRunResources(store, runIds, kinds);
  const resources = kinds.includes('lastLogs')
    ? {
        ...runResources,
        lastLogs: await omitListedLogs(store, filter, runResources.lastLogs),
      }
    : runResources;
  yield '],\n"included":[';
  started = false;
  for (const kind of kinds) {
    for (const resource of resources[kind]) {
      yield started ? ',\n' : '\n';
      started = true;
      yield JSON.stringify(resource);
    }
  }
  yield '\n]}';
}

/** The log's document, or undefined if no log matches `filter`. */
export async function getLogDocument(
  store: DataStore,
  filter: Omit<AllFilter, 'runStatus'>,
  include: IncludeQuery<typeof logIncludes>,
) {
  const logs = await fromAsync(
    store.getLogs({ ...filter, runStatus: '-canceled' }),
  );
  if (logs.length > 1) {
    throw new Error(`More than one log found for ${JSON.stringify(filter)}`);
  }
  const log = logs[0];
  if (log === undefined) return undefined;
  const kinds = getIncludedKinds(logIncludes, include);
  const resources = await getIncludedRunResources(store, [log.runId], kinds);
  // The log is the document's data: it is not included again as a last log.
  const lastLogs = resources.lastLogs.filter(({ id }) => id !== log.logId);
  return withIncluded(logResource(log), { ...resources, lastLogs }, kinds);
}

/**
 * The logs the document does not list in its data. A compound document holds a
 * resource once, and the last log of a run is usually one of the logs listed.
 */
async function omitListedLogs(
  store: DataStore,
  filter: Omit<AllFilter, 'runStatus'>,
  logs: RunResources['lastLogs'],
) {
  const listed = new Set<LogId>();
  // By chunks: a log id is a bound variable, and a run has a last log per type.
  for (const logId of chunk(
    logs.map(({ id }) => id),
    1000,
  )) {
    for await (const log of store.getLogs({
      ...filter,
      runStatus: '-canceled',
      logId,
    })) {
      listed.add(log.logId);
    }
  }
  return logs.filter(({ id }) => !listed.has(id));
}

/** The resources `kinds` ask for, looked up only if there is any to ask for. */
async function getIncludedRunResources(
  store: DataStore,
  runIds: Iterable<RunId>,
  kinds: Array<keyof RunResources>,
) {
  // Each run id is a bound variable of the lookups, and SQLite stops at 32,766:
  // a document over more runs fails (the response is aborted). Look up by
  // chunks if exports ever get there.
  const runIdList = [...runIds];
  return kinds.length === 0 || runIdList.length === 0
    ? noRunResources
    : getRunResources(store, { filter: { runId: runIdList } });
}
