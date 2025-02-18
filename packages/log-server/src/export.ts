import { pipeline, Readable } from 'node:stream';
import { stringify } from 'csv';
import { mapKeys, pickBy, pipe } from 'remeda';
import { Log, LogFilter, Store } from './store.js';
import { toSnakeCase } from './utils.js';

const csvLogColumns: Array<keyof Log> = [
  'type',
  'experimentName',
  'runName',
  'runStatus',
];
const jsonLogColumns: Array<keyof Log> = [
  'type',
  'experimentName',
  'runName',
  'values',
  'runStatus',
];
const renamedLogColumns: Partial<Record<keyof Log, string>> = {};

export function csvExportStream(
  store: Pick<Store, 'getLogs' | 'getLogValueNames'>,
  filter: Omit<LogFilter, 'runStatus'> = {},
): Readable {
  const filterWithValidRun = { ...filter, runStatus: '-canceled' } as const;
  return pipeline(
    async function* () {
      let valueColumns = await store.getLogValueNames(filterWithValidRun);
      let logColumnFilter = (columnName: keyof Log) =>
        !valueColumns.includes(columnName) &&
        (filter?.type == null ||
          Array.isArray(filter.type) ||
          columnName !== 'type') &&
        (filter?.experimentName == null ||
          Array.isArray(filter.experimentName) ||
          columnName !== 'experimentName') &&
        (filter?.runName == null ||
          Array.isArray(filter.runName) ||
          columnName !== 'runName') &&
        csvLogColumns.includes(columnName);
      let columns = [
        ...csvLogColumns
          .filter(logColumnFilter)
          .map((c) => renamedLogColumns[c] ?? c),
        ...valueColumns,
      ];
      let baseLog: Record<string, undefined> = {};
      // We need to set all columns to undefined to make sure they are included
      // in the CSV even if they are empty.
      for (let column of columns) {
        baseLog[column] = undefined;
      }
      for await (let log of store.getLogs(filterWithValidRun)) {
        // Note: the type of this appears to be completely incorrect, but it
        // does not matter since it is immediately piped to stringify anyway.
        yield toSnakeCase({
          ...baseLog,
          ...pipe(
            log,
            pickBy((v, k) => logColumnFilter(k)),
            mapKeys((key) => renamedLogColumns[key] ?? key),
          ),
          ...log.values,
        });
      }
    },
    stringify({
      header: true,
      cast: {
        date: (value) => value.toISOString(),
        number: (value) => value.toString(),
        object: (value) => JSON.stringify(value),
        bigint: (value) => value.toString(),
        boolean: (value) => (value ? 'true' : 'false'),
      },
    }),
    () => {
      // Nothing to do here.
    },
  );
}

export function jsonExportStream(
  store: Pick<Store, 'getLogs'>,
  filter: Omit<LogFilter, 'runStatus'> = {},
) {
  return Readable.from(
    stringifyLogs(store.getLogs({ ...filter, runStatus: ['-canceled'] })),
  );
}

async function* stringifyLogs(logs: AsyncIterable<Log>) {
  yield '[';
  let started = false;
  for await (let log of logs) {
    let prefix = started ? ',\n' : '\n';
    started = true;
    let content = JSON.stringify(
      pipe(
        log,
        pickBy((v, k) => jsonLogColumns.includes(k)),
        mapKeys((key) => renamedLogColumns[key] ?? key),
      ),
      stringifyDateSerializer,
    );
    yield `${prefix}${content}`;
  }
  yield '\n]';
}

function stringifyDateSerializer(key: string, value: unknown) {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return value;
}
