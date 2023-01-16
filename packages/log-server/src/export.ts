import { pipeline, Readable } from 'node:stream';
import { stringify } from 'csv';
import { pickBy } from 'remeda';
import { Store } from './store.js';

const logColumns = ['type', 'experimentId', 'runId', 'createdAt'] as const;

export function csvExportStream(
  store: Store,
  filter: Parameters<Store['getLogs']>[0] &
    Parameters<Store['getLogValueNames']>[0]
): Readable {
  return pipeline(
    async function* () {
      let valueColumns = await store.getLogValueNames(filter);
      let hasNonEmptyExperimentId = await store.hasNonEmptyExperimentId();
      let logColumnFilter = (columnName: string) =>
        !valueColumns.includes(columnName) &&
        (hasNonEmptyExperimentId || columnName !== 'experimentId') &&
        (filter?.type == null || columnName !== 'type') &&
        columnName !== 'values';
      let columns = [...logColumns.filter(logColumnFilter), ...valueColumns];
      let baseLog: Record<string, undefined> = {};
      // We need to set all columns to undefined to make sure they are included
      // in the CSV even if they are empty.
      for (let column of columns) {
        baseLog[column] = undefined;
      }
      for await (let log of store.getLogs(filter)) {
        // Note: the type of this appears to be completely incorrect, but it
        // does not matter since it is immediately piped to stringify anyway.
        yield {
          ...baseLog,
          ...pickBy(log, (v, k) => logColumnFilter(k)),
          ...log.values,
        };
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
    }
  );
}

export function jsonExportStream(
  store: Store,
  filter: Parameters<Store['getLogs']>[0]
) {
  return Readable.from(stringifyLogs(store.getLogs(filter)));
}

async function* stringifyLogs(
  logs: AsyncIterable<{
    type: string;
    experimentId?: string;
  }>
) {
  yield '[';
  let started = false;
  for await (let log of logs) {
    yield started ? ',' : '';
    started = true;
    yield JSON.stringify(log, stringifyDateReplacer);
  }
  yield ']';
}

function stringifyDateReplacer(key: string, value: unknown) {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return value;
}
