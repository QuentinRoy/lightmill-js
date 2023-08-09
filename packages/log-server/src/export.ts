import { pipeline, Readable } from 'node:stream';
import { stringify } from 'csv';
import { mapKeys, pickBy, pipe } from 'remeda';
import { Log, Store } from './store.js';
import { toSnakeCase } from './utils.js';

const logColumns: Array<keyof Log> = ['type', 'experimentId', 'runId'];
const renamedLogColumns: Partial<Record<keyof Log, string>> = {
  experimentId: 'experiment',
  runId: 'run',
};
const ignoredLogValues: Array<keyof Log> = ['values'];

export function csvExportStream(
  store: Store,
  filter: Parameters<Store['getLogs']>[0] &
    Parameters<Store['getLogValueNames']>[0],
): Readable {
  return pipeline(
    async function* () {
      let valueColumns = await store.getLogValueNames(filter);
      let logColumnFilter = (columnName: keyof Log) =>
        !valueColumns.includes(columnName) &&
        (filter?.type == null || columnName !== 'type') &&
        (filter?.experiment == null || columnName !== 'experimentId') &&
        (filter?.run == null || columnName !== 'runId') &&
        !ignoredLogValues.includes(columnName);
      let columns = [
        ...logColumns
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
      for await (let log of store.getLogs(filter)) {
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
  store: Store,
  filter: Parameters<Store['getLogs']>[0],
) {
  return Readable.from(stringifyLogs(store.getLogs(filter)));
}

async function* stringifyLogs(logs: AsyncIterable<Log>) {
  yield '[';
  let started = false;
  for await (let log of logs) {
    yield started ? ',' : '';
    started = true;
    yield JSON.stringify(
      mapKeys(log, (key) => renamedLogColumns[key] ?? key),
      stringifyDateSerializer,
    );
  }
  yield ']';
}

function stringifyDateSerializer(key: string, value: unknown) {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return value;
}
