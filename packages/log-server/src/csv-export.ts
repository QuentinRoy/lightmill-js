import { stringify } from 'csv';
import { pipeline, Readable } from 'node:stream';
import { mapKeys, pickBy, pipe } from 'remeda';
import { type AllFilter, type Log, SQLiteStore as Store } from './store.js';
import { withSnakeCaseProps } from './utils.js';

const csvLogColumns: Array<keyof Log> = [
  'type',
  'experimentName',
  'runName',
  'runStatus',
];
const renamedLogColumns: Partial<Record<keyof Log, string>> = {};

export function csvExportStream(
  store: Pick<Store, 'getLogs' | 'getLogValueNames'>,
  filter: Omit<AllFilter, 'runStatus'> = {},
): Readable {
  const filterWithValidRun = { ...filter, runStatus: '-canceled' } as const;
  return pipeline(
    async function* () {
      let valueColumns = await store.getLogValueNames(filterWithValidRun);
      let logColumnFilter = (columnName: keyof Log) =>
        !valueColumns.includes(columnName) &&
        (filter?.logType == null ||
          Array.isArray(filter.logType) ||
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
        yield withSnakeCaseProps({
          ...baseLog,
          ...pipe(
            log,
            pickBy((_v, k) => logColumnFilter(k)),
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
