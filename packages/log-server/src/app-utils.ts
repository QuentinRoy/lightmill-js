import type { paths } from '@lightmill/log-api';
import type { SessionData } from 'express-session';
import { groupBy, intersection, map, pipe, uniqueBy } from 'remeda';
import type { Simplify, WritableDeep } from 'type-fest';
import {
  type ApiPath,
  type HttpMethod,
  httpStatuses,
  type HttpStatusMap,
} from './api-utils.js';
import type { RunId, Store } from './store.js';
import type {
  Handler,
  HandlerParameters,
  HandlerResult,
  RequestContent,
  ServerDescription,
} from './typed-server.js';
import { arrayify } from './utils.js';

declare module 'express-session' {
  interface SessionData {
    data: { role: 'participant' | 'host'; runs: RunId[] };
  }
}

// This needs to be a type (not an interface) so we can use it with
// typed-server... I don't know why, but it's not worth investigating.
export type ServerApi = Simplify<paths>;

export type ServerHandler<
  Path extends ApiPath<ServerApi>,
  Method extends HttpMethod,
> = Handler<ServerApi, Path, Method>;

export type ServerHandlerResult<
  Path extends ApiPath<ServerApi>,
  Method extends HttpMethod,
> = HandlerResult<ServerApi, Path, Method>;

export type ServerHandlerBody<
  Path extends ApiPath<ServerApi>,
  Method extends HttpMethod,
> = ServerHandlerResult<Path, Method>['body'];

export type ServerHandlerIncluded<
  Path extends ApiPath<ServerApi>,
  Method extends HttpMethod,
> =
  ServerHandlerBody<Path, Method> extends infer B
    ? B extends { readonly included?: infer I }
      ? I
      : never
    : never;

export type ServerHandlerParameter<
  Path extends ApiPath<ServerApi>,
  Method extends HttpMethod,
> = HandlerParameters<ServerApi, Path, Method>;

export type ServerRequestContent<
  Path extends ApiPath<ServerApi>,
  Method extends HttpMethod,
> = RequestContent<ServerApi, Path, Method>;

export function getErrorResponse<
  const T extends {
    status: keyof HttpStatusMap;
    code: string;
    detail?: string;
    source?: object;
  },
>(option: T) {
  let error: WritableDeep<Omit<T, 'status'>> & {
    status: HttpStatusMap[T['status']];
  } = { ...structuredClone(option), status: httpStatuses[option.status] };
  return {
    status: option.status as T['status'],
    body: { errors: [error] },
    contentType: 'application/json' as const,
  };
}

export type SubServerDescription<K extends string> = Pick<
  ServerDescription<ServerApi>,
  Extract<keyof ServerDescription<ServerApi>, `${K}${string}`>
>;

type GetRunResourcesOptions =
  | { filter: Parameters<Store['getRuns']>[0] }
  | {
      runs: Omit<
        Awaited<ReturnType<Store['getRuns']>>[number],
        'runCreatedAt'
      >[];
    };
export async function getRunResources(
  store: Store,
  options: GetRunResourcesOptions,
) {
  const runs =
    'runs' in options ? options.runs : await store.getRuns(options.filter);
  const [experiments, lastLogs] = await Promise.all([
    store.getExperiments({
      experimentId: pipe(
        runs,
        uniqueBy((run) => run.experimentId),
        map((run) => run.experimentId),
      ),
    }),
    store.getLastLogs({ runId: runs.map((run) => run.runId) }),
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
          lastLogNumber: Math.max(0, ...runLastLogs.map((l) => l.number)),
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
