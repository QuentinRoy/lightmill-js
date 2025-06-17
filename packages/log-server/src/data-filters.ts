import type { ColumnType, SelectQueryBuilder } from 'kysely';
import type { ReadonlyDeep } from 'type-fest';
import {
  runStatuses,
  toDbId,
  type ExperimentId,
  type RunId,
  type RunStatus,
} from './data-store.ts';
import { arrayify, firstStrict, removePrefix, startsWith } from './utils.ts';

export const createQueryFilterRun = createQueryFilterFactory(parseRunFilter);
export const createQueryFilterExperiment = createQueryFilterFactory(
  parseExperimentFilter,
);
export const createQueryFilterAll = createQueryFilterFactory(parseAllFilter);

export type ExperimentFilter = ReadonlyDeep<{
  experimentName?: string | string[] | undefined;
  experimentId?: ExperimentId | ExperimentId[] | undefined;
}>;

export type LogFilter = ReadonlyDeep<{
  logType?: string | string[] | undefined;
  logId?: string | string[] | undefined;
}>;

export type AllFilter = LogFilter & RunFilter & ExperimentFilter;

export type RunFilter = ReadonlyDeep<{
  experimentId?: ExperimentId | ExperimentId[] | undefined;
  runName?: string | string[] | undefined;
  runStatus?:
    | RunStatus
    | RunStatus[]
    | `-${RunStatus}`
    | `-${RunStatus}`[]
    | undefined;
  runId?: RunId | RunId[] | undefined;
}>;

function createParsedFilterQuery<
  O extends ParsedFilter,
  Namespace extends string,
>(parsedFilter: O, namespace: Namespace) {
  return <
    SQB extends SelectQueryBuilder<
      FilterableDb<Namespace, O>,
      Namespace,
      object
    >,
  >(
    qb: SQB,
  ): SQB => {
    const clauses = Object.entries(parsedFilter).flatMap(
      ([k, v]): Clause<O, Namespace>[] => {
        if (v === undefined) return [];
        if (v.length === 1) {
          // @ts-expect-error This is fine (I think).
          return [[`${namespace}.${k}`, '=', v[0]]];
        }
        // @ts-expect-error This is fine.
        return [[`${namespace}.${k}`, 'in', v]];
      },
    );
    if (clauses.length == 0) return qb;
    if (clauses.length == 1) {
      // @ts-expect-error This is fine.
      return qb.where(...clauses[0]);
    }
    // @ts-expect-error This is fine (I think).
    return qb.where((wb) => wb.and(clauses.map((c) => wb(...c))));
  };
}
function createQueryFilterFactory<I, O extends ParsedFilter>(
  parser: (input: I) => O,
) {
  return <Namespace extends string>(filter: I, n: Namespace) =>
    createParsedFilterQuery(parser(filter), n);
}

type Clause<T extends ParsedFilter, Namespace extends string> = {
  [K in Extract<keyof T, string>]:
    | [`${Namespace}.${K}`, 'in', NonNullable<T[K]>]
    | [`${Namespace}.${K}`, '=', NonNullable<T[K]>[number]];
}[Extract<keyof T, string>];
type ParsedFilter = Record<string, unknown[] | undefined>;
type FilterableDb<Namespace extends string, F extends ParsedFilter> = Record<
  Namespace,
  {
    [K in keyof F]: ColumnType<
      NonNullable<F[K]>[number] | undefined,
      unknown,
      unknown
    >;
  }
>;

function parseExperimentFilter(experimentFilter: ExperimentFilter) {
  return {
    experimentName:
      experimentFilter.experimentName == null
        ? undefined
        : arrayify(experimentFilter.experimentName),
    experimentId:
      experimentFilter.experimentId == null
        ? undefined
        : arrayify(experimentFilter.experimentId).map(toDbId),
  };
}

function parseRunFilter(runFilter: RunFilter) {
  return {
    experimentId:
      runFilter.experimentId == null
        ? undefined
        : arrayify(runFilter.experimentId).map(toDbId),
    runName:
      runFilter.runName == null ? undefined : arrayify(runFilter.runName),
    runId:
      runFilter.runId == null
        ? undefined
        : arrayify(runFilter.runId).map(toDbId),
    runStatus: parseRunStatusFilter(runFilter.runStatus),
  };
}

function parseLogFilter(logFilter: LogFilter) {
  return {
    logType:
      logFilter.logType == null ? undefined : arrayify(logFilter.logType),
    logId:
      logFilter.logId == null
        ? undefined
        : arrayify(logFilter.logId).map(toDbId),
  };
}

function parseAllFilter(filter: AllFilter) {
  return {
    ...parseExperimentFilter(filter),
    ...parseRunFilter(filter),
    ...parseLogFilter(filter),
  };
}

/**
 * Parses a run status filter and converts it into an array of RunStatus values.
 * The filter can be a single RunStatus, an array of RunStatus values, or strings with a '-' prefix
 * to indicate exclusion.
 *
 * If a status is prefixed with '-', it is excluded from the final set of statuses.
 * If the first status begins with '-', the initial set includes all runStatuses, then removes the excluded ones.
 * Otherwise, the initial set is empty and only includes explicitly specified statuses.
 *
 * @param runStatusFilter - A RunStatus, array of RunStatus values, or strings with '-' prefix for exclusion
 * @returns Array of RunStatus values after applying inclusions/exclusions, or undefined if input is undefined
 */
export function parseRunStatusFilter(runStatusFilter: RunFilter['runStatus']) {
  if (runStatusFilter == null) return undefined;
  const runStatusFilterArray = arrayify(runStatusFilter, true);
  if (runStatusFilterArray.length === 0) return [];
  const include = new Set<RunStatus>(
    firstStrict(runStatusFilterArray).startsWith('-') ? runStatuses : undefined,
  );
  for (let status of runStatusFilterArray) {
    if (startsWith(status, '-')) {
      include.delete(removePrefix(status, '-'));
    } else {
      include.add(status);
    }
  }
  return Array.from(include);
}
