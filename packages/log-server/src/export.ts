import { Readable } from 'node:stream';
import { JsonValue } from 'type-fest';
import { stringify } from 'csv';
import { pickBy } from 'lodash-es';
import { Store } from './store.js';

const logColumns = ['type', 'experimentId', 'runId', 'createdAt'] as const;

export function csvExportStream(
  store: Store,
  filter: Parameters<Store['getLogs']>[0] &
    Parameters<Store['getLogValueNames']>[0]
) {
  async function getInnerStream() {
    let valueColumns = await store.getLogValueNames(filter);
    let hasNonEmptyExperimentId = await store.hasNonEmptyExperimentId();
    let logColumnFilter = (columnName: string) =>
      !valueColumns.includes(columnName) &&
      (hasNonEmptyExperimentId || columnName !== 'experimentId') &&
      (filter?.type == null || columnName !== 'type');
    let columns = [...logColumns.filter(logColumnFilter), ...valueColumns];
    return csvStreamFromLogs(
      columns,
      store.getLogs(filter),
      ({ values, ...log }) => ({
        ...pickBy(log, (v, k) => logColumnFilter(k)),
        ...values,
      })
    );
  }
  let innerStream: Readable | undefined;
  return new Readable({
    objectMode: true,
    read() {
      if (!innerStream) {
        getInnerStream()
          .then((stream) => {
            innerStream = stream;
            innerStream.on('data', (data) => this.push(data));
            innerStream.on('error', (error) => this.emit('error', error));
            innerStream.on('end', () => this.push(null));
            innerStream.read();
          })
          .catch((error) => {
            this.emit('error', error);
          });
      } else {
        innerStream.read();
      }
    },
  });
}

export function jsonExportStream(
  store: Store,
  filter: Parameters<Store['getLogs']>[0]
) {
  return jsonStreamFromLogs(store.getLogs(filter));
}

function csvStreamFromLogs<T>(
  columns: string[],
  logs: AsyncGenerator<T>,
  map: (log: T) => Record<string, unknown>
) {
  return new Readable({
    objectMode: true,
    read() {
      logs
        .next()
        .then(({ done, value }) => {
          if (done) {
            this.push(null);
          } else {
            this.push(map(value));
          }
        })
        .catch((error) => {
          this.emit('error', error);
        });
    },
  }).pipe(
    stringify({
      header: true,
      columns,
      cast: {
        date: (value) => value.toISOString(),
        number: (value) => value.toString(),
        object: (value) => JSON.stringify(value),
        bigint: (value) => value.toString(),
        boolean: (value) => (value ? 'true' : 'false'),
      },
    })
  );
}

function jsonStreamFromLogs(
  logs: AsyncGenerator<Record<string, JsonValue | Date | undefined>>
) {
  let started = false;
  return new Readable({
    read() {
      let willAddComma = started;
      if (!started) {
        this.push('[');
        started = true;
      }
      logs
        .next()
        .then(({ done, value }) => {
          if (done) {
            this.push(']');
            this.push(null);
          } else {
            if (willAddComma) this.push(',');
            this.push(JSON.stringify(value, stringifyDateReplacer));
          }
        })
        .catch((error) => {
          this.emit('error', error);
        });
    },
  });
}

function stringifyDateReplacer(key: string, value: unknown) {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return value;
}
