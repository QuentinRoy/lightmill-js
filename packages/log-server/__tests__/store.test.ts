import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import loglevel from 'loglevel';
// These tests must run on the compiled code, not the source code, because
// kysely does not support typescript migration files.
import { SQLiteStore } from '../dist/store.js';

// Prevent kysely from logging anything.
loglevel.setDefaultLevel('silent');

describe('SQLiteStore', () => {
  it('should create and close a new Store instance without error', async () => {
    let store = new SQLiteStore(':memory:');
    await store.close();
  });
});

describe('SQLiteStore#migrateDatabase', () => {
  it('should initialize the database without errors', async () => {
    let store = new SQLiteStore(':memory:');
    let resultSet = await store.migrateDatabase();
    expect(resultSet.error).toBeUndefined();
    expect(resultSet.results).toBeDefined();
    expect(resultSet.results?.length).toBeGreaterThan(0);
    resultSet.results?.forEach((result) => {
      expect(result.status).toBe('Success');
    });
    await store.close();
  });
});

describe('SQLiteStore#addRun', () => {
  let store: SQLiteStore;
  beforeEach(async () => {
    store = new SQLiteStore(':memory:');
    await store.migrateDatabase();
  });
  afterEach(async () => {
    await store.close();
  });
  it('should add runs with different ids without error', async () => {
    await expect(
      store.addRun({
        runId: 'run1',
        experimentId: 'experiment1',
      }),
    ).resolves.toEqual({ runId: 'run1', experimentId: 'experiment1' });
    await expect(
      store.addRun({
        runId: 'run2',
        experimentId: 'experiment1',
      }),
    ).resolves.toEqual({ runId: 'run2', experimentId: 'experiment1' });
    await expect(
      store.addRun({
        runId: 'run3',
        experimentId: 'experiment2',
      }),
    ).resolves.toEqual({ runId: 'run3', experimentId: 'experiment2' });
  });
  it('should refuse to add a run if a run with the same id already exists for the experiment', async () => {
    await store.addRun({
      runId: 'run1',
      experimentId: 'experiment1',
    });
    await expect(
      store.addRun({
        runId: 'run1',
        experimentId: 'experiment1',
      }),
    ).rejects.toThrow();
  });
  it('should add a run if a run with the same id already exists but for a different experiment', async () => {
    await expect(
      store.addRun({
        runId: 'run-id',
        experimentId: 'experiment1',
      }),
    ).resolves.toEqual({ runId: 'run-id', experimentId: 'experiment1' });
    await expect(
      store.addRun({
        runId: 'run-id',
        experimentId: 'experiment2',
      }),
    ).resolves.toEqual({ runId: 'run-id', experimentId: 'experiment2' });
  });
});

describe('SQLiteStore#getRun', () => {
  let store: SQLiteStore;
  beforeEach(async () => {
    store = new SQLiteStore(':memory:');
    await store.migrateDatabase();
    await store.addRun({
      runId: 'run1',
      experimentId: 'experiment',
    });
    await store.addRun({
      runId: 'run2',
      experimentId: 'experiment',
    });
  });
  afterEach(async () => {
    await store.close();
  });
  it('should return the run if it exists', async () => {
    await expect(store.getRun('experiment', 'run1')).resolves.toEqual({
      runId: 'run1',
      experimentId: 'experiment',
      status: 'running',
    });
  });
  it('should return undefined if the run does not exist', async () => {
    await expect(
      store.getRun('experiment', 'unknown-run'),
    ).resolves.toBeUndefined();
  });
});

describe('SQLiteStore#addLogs', () => {
  let store: SQLiteStore;
  beforeEach(async () => {
    store = new SQLiteStore(':memory:');
    await store.migrateDatabase();
    await store.addRun({
      runId: 'run1',
      experimentId: 'experiment',
    });
    await store.addRun({
      runId: 'run2',
      experimentId: 'experiment',
    });
  });
  afterEach(async () => {
    await store.close();
  });
  it('should add non empty logs without error', async () => {
    await expect(
      store.addLogs('experiment', 'run1', [
        {
          type: 'log',
          number: 1,
          values: { message: 'hello', bar: null },
        },
        {
          type: 'log',
          number: 2,
          values: { message: 'bonjour', recipient: 'Jo' },
        },
      ]),
    ).resolves.toBeUndefined();
    await expect(
      store.addLogs('experiment', 'run2', [
        {
          number: 3,
          type: 'other-log',
          values: { x: 12, foo: false },
        },
        {
          number: 4,
          type: 'log',
          values: { message: 'hola' },
        },
      ]),
    ).resolves.toBeUndefined();
  });
  it('should add empty logs without error', async () => {
    await expect(
      store.addLogs('experiment', 'run1', [
        { type: 'log', number: 1, values: {} },
        { type: 'log', number: 2, values: {} },
      ]),
    ).resolves.toBeUndefined();
    await expect(
      store.addLogs('experiment', 'run2', [
        { number: 3, type: 'other-log', values: {} },
        { number: 4, type: 'log', values: {} },
      ]),
    ).resolves.toBeUndefined();
  });
  it('should refuse to add two logs with the same number for the same run', async () => {
    await expect(
      store.addLogs('experiment', 'run1', [
        { type: 'log', number: 1, values: {} },
        { type: 'log', number: 2, values: {} },
      ]),
    ).resolves.toBeUndefined();
    await expect(
      store.addLogs('experiment', 'run1', [
        { type: 'log', number: 2, values: {} },
      ]),
    ).rejects.toThrow();
    await expect(
      store.addLogs('experiment', 'run1', [
        { type: 'log1', number: 3, values: {} },
        { type: 'log2', number: 3, values: {} },
      ]),
    ).rejects.toThrow();
  });
});

describe('SQLiteStore#getLogValueNames', () => {
  let store: SQLiteStore;
  beforeEach(async () => {
    store = new SQLiteStore(':memory:');
    await store.migrateDatabase();
    await store.addRun({ runId: 'run1', experimentId: 'experiment1' });
    await store.addRun({ runId: 'run2', experimentId: 'experiment1' });
    await store.addRun({ runId: 'run1', experimentId: 'experiment2' });
    await store.addLogs('experiment1', 'run1', [
      {
        type: 'log1',
        values: { message: 'hello', recipient: 'Anna' },
        number: 1,
      },
      {
        type: 'log1',
        values: { message: 'bonjour', recipient: 'Jo' },
        number: 2,
      },
    ]);
    await store.addLogs('experiment1', 'run2', [
      {
        type: 'log2',
        values: { x: 12, foo: false },
        number: 3,
      },
      {
        type: 'log1',
        values: { message: 'hola', bar: null },
        number: 4,
      },
    ]);
    await store.addLogs('experiment2', 'run1', [
      {
        type: 'log2',
        values: { x: 25, y: 0, foo: true },
        number: 5,
      },
    ]);
  });
  afterEach(async () => {
    await store.close();
  });

  it('should return the names of all log values in alphabetical order', async () => {
    await expect(store.getLogValueNames()).resolves.toEqual([
      'bar',
      'foo',
      'message',
      'recipient',
      'x',
      'y',
    ]);
  });
  it('should be able to filter logs of a particular type', async () => {
    await expect(store.getLogValueNames({ type: 'log1' })).resolves.toEqual([
      'bar',
      'message',
      'recipient',
    ]);
    await expect(store.getLogValueNames({ type: 'log2' })).resolves.toEqual([
      'foo',
      'x',
      'y',
    ]);
  });
  it('should be able to filter logs from a particular experiment', async () => {
    await expect(
      store.getLogValueNames({ experiment: 'experiment1' }),
    ).resolves.toEqual(['bar', 'foo', 'message', 'recipient', 'x']);
    await expect(
      store.getLogValueNames({ experiment: 'experiment2' }),
    ).resolves.toEqual(['foo', 'x', 'y']);
  });
  it('should be able to filter logs from a particular run', async () => {
    await expect(store.getLogValueNames({ run: 'run1' })).resolves.toEqual([
      'foo',
      'message',
      'recipient',
      'x',
      'y',
    ]);
    await expect(store.getLogValueNames({ run: 'run2' })).resolves.toEqual([
      'bar',
      'foo',
      'message',
      'x',
    ]);
  });
  it('should be able to filter logs by run, experiment, and type all at once', async () => {
    await expect(
      store.getLogValueNames({ experiment: 'experiment1', type: 'log2' }),
    ).resolves.toEqual(['foo', 'x']);
    await expect(
      store.getLogValueNames({
        experiment: 'experiment1',
        type: 'log1',
        run: 'run1',
      }),
    ).resolves.toEqual(['message', 'recipient']);
  });
  it('should resolve with an empty array if no log matches the filter', async () => {
    await expect(
      store.getLogValueNames({ experiment: 'experiment2', type: 'log1' }),
    ).resolves.toEqual([]);
    await expect(
      store.getLogValueNames({ experiment: 'do not exist' }),
    ).resolves.toEqual([]);
    await expect(
      store.getLogValueNames({ run: 'do not exist' }),
    ).resolves.toEqual([]);
    await expect(
      store.getLogValueNames({ type: 'do not exist' }),
    ).resolves.toEqual([]);
  });
});

describe('SQLiteStore#getLogs', () => {
  let store: SQLiteStore;
  beforeEach(async () => {
    store = new SQLiteStore(':memory:');
    await store.migrateDatabase();
    await store.addRun({ runId: 'run1', experimentId: 'experiment1' });
    await store.addRun({ runId: 'run2', experimentId: 'experiment1' });
    await store.addRun({ runId: 'run1', experimentId: 'experiment2' });
    await store.addLogs('experiment1', 'run1', [
      {
        type: 'log1',
        number: 1,
        values: { message: 'hello', recipient: 'Anna' },
      },
      {
        type: 'log1',
        number: 5,
        values: { message: 'bonjour', recipient: 'Jo' },
      },
    ]);
    await store.addLogs('experiment1', 'run2', [
      {
        type: 'log1',
        number: 4,
        values: { message: 'hola', bar: null },
      },
      {
        type: 'log2',
        number: 3,
        values: { x: 12, foo: false },
      },
    ]);
    await store.addLogs('experiment2', 'run1', [
      {
        type: 'log2',
        number: 6,
        values: { x: 25, y: 0, foo: true },
      },
    ]);
    await store.addLogs('experiment1', 'run1', [
      {
        type: 'log3',
        number: 2,
        values: { x: 25, y: 0, foo: true },
      },
    ]);
  });
  afterEach(async () => {
    await store.close();
  });

  it('should return the logs in order of experimentId, runId, and ascending number', async () => {
    await expect(fromAsync(store.getLogs())).resolves.toMatchInlineSnapshot(`
      [
        {
          "experimentId": "experiment1",
          "number": 1,
          "runId": "run1",
          "type": "log1",
          "values": {
            "message": "hello",
            "recipient": "Anna",
          },
        },
        {
          "experimentId": "experiment1",
          "number": 2,
          "runId": "run1",
          "type": "log3",
          "values": {
            "foo": true,
            "x": 25,
            "y": 0,
          },
        },
        {
          "experimentId": "experiment1",
          "number": 5,
          "runId": "run1",
          "type": "log1",
          "values": {
            "message": "bonjour",
            "recipient": "Jo",
          },
        },
        {
          "experimentId": "experiment1",
          "number": 3,
          "runId": "run2",
          "type": "log2",
          "values": {
            "foo": false,
            "x": 12,
          },
        },
        {
          "experimentId": "experiment1",
          "number": 4,
          "runId": "run2",
          "type": "log1",
          "values": {
            "bar": null,
            "message": "hola",
          },
        },
        {
          "experimentId": "experiment2",
          "number": 6,
          "runId": "run1",
          "type": "log2",
          "values": {
            "foo": true,
            "x": 25,
            "y": 0,
          },
        },
      ]
    `);
  });
  it('should be able to filter logs of a particular type', async () => {
    await expect(fromAsync(store.getLogs({ type: 'log1' }))).resolves
      .toMatchInlineSnapshot(`
      [
        {
          "experimentId": "experiment1",
          "number": 1,
          "runId": "run1",
          "type": "log1",
          "values": {
            "message": "hello",
            "recipient": "Anna",
          },
        },
        {
          "experimentId": "experiment1",
          "number": 5,
          "runId": "run1",
          "type": "log1",
          "values": {
            "message": "bonjour",
            "recipient": "Jo",
          },
        },
        {
          "experimentId": "experiment1",
          "number": 4,
          "runId": "run2",
          "type": "log1",
          "values": {
            "bar": null,
            "message": "hola",
          },
        },
      ]
    `);
    await expect(fromAsync(store.getLogs({ type: 'log2' }))).resolves
      .toMatchInlineSnapshot(`
      [
        {
          "experimentId": "experiment1",
          "number": 3,
          "runId": "run2",
          "type": "log2",
          "values": {
            "foo": false,
            "x": 12,
          },
        },
        {
          "experimentId": "experiment2",
          "number": 6,
          "runId": "run1",
          "type": "log2",
          "values": {
            "foo": true,
            "x": 25,
            "y": 0,
          },
        },
      ]
    `);
  });
  it('should be able to filter logs from a particular experiment', async () => {
    await expect(fromAsync(store.getLogs({ experiment: 'experiment1' })))
      .resolves.toMatchInlineSnapshot(`
      [
        {
          "experimentId": "experiment1",
          "number": 1,
          "runId": "run1",
          "type": "log1",
          "values": {
            "message": "hello",
            "recipient": "Anna",
          },
        },
        {
          "experimentId": "experiment1",
          "number": 2,
          "runId": "run1",
          "type": "log3",
          "values": {
            "foo": true,
            "x": 25,
            "y": 0,
          },
        },
        {
          "experimentId": "experiment1",
          "number": 5,
          "runId": "run1",
          "type": "log1",
          "values": {
            "message": "bonjour",
            "recipient": "Jo",
          },
        },
        {
          "experimentId": "experiment1",
          "number": 3,
          "runId": "run2",
          "type": "log2",
          "values": {
            "foo": false,
            "x": 12,
          },
        },
        {
          "experimentId": "experiment1",
          "number": 4,
          "runId": "run2",
          "type": "log1",
          "values": {
            "bar": null,
            "message": "hola",
          },
        },
      ]
    `);
    await expect(fromAsync(store.getLogs({ experiment: 'experiment2' })))
      .resolves.toMatchInlineSnapshot(`
      [
        {
          "experimentId": "experiment2",
          "number": 6,
          "runId": "run1",
          "type": "log2",
          "values": {
            "foo": true,
            "x": 25,
            "y": 0,
          },
        },
      ]
    `);
  });
  it('should be able to filter logs from a particular run', async () => {
    await expect(fromAsync(store.getLogs({ run: 'run1' }))).resolves
      .toMatchInlineSnapshot(`
      [
        {
          "experimentId": "experiment1",
          "number": 1,
          "runId": "run1",
          "type": "log1",
          "values": {
            "message": "hello",
            "recipient": "Anna",
          },
        },
        {
          "experimentId": "experiment1",
          "number": 2,
          "runId": "run1",
          "type": "log3",
          "values": {
            "foo": true,
            "x": 25,
            "y": 0,
          },
        },
        {
          "experimentId": "experiment1",
          "number": 5,
          "runId": "run1",
          "type": "log1",
          "values": {
            "message": "bonjour",
            "recipient": "Jo",
          },
        },
        {
          "experimentId": "experiment2",
          "number": 6,
          "runId": "run1",
          "type": "log2",
          "values": {
            "foo": true,
            "x": 25,
            "y": 0,
          },
        },
      ]
    `);
    await expect(fromAsync(store.getLogs({ run: 'run2' }))).resolves
      .toMatchInlineSnapshot(`
      [
        {
          "experimentId": "experiment1",
          "number": 3,
          "runId": "run2",
          "type": "log2",
          "values": {
            "foo": false,
            "x": 12,
          },
        },
        {
          "experimentId": "experiment1",
          "number": 4,
          "runId": "run2",
          "type": "log1",
          "values": {
            "bar": null,
            "message": "hola",
          },
        },
      ]
    `);
  });
  it('should be able to filter logs by run, experiment, and type all at once', async () => {
    await expect(
      fromAsync(store.getLogs({ experiment: 'experiment1', type: 'log2' })),
    ).resolves.toMatchInlineSnapshot(`
      [
        {
          "experimentId": "experiment1",
          "number": 3,
          "runId": "run2",
          "type": "log2",
          "values": {
            "foo": false,
            "x": 12,
          },
        },
      ]
    `);
    await expect(
      fromAsync(
        store.getLogs({
          experiment: 'experiment1',
          type: 'log1',
          run: 'run1',
        }),
      ),
    ).resolves.toMatchInlineSnapshot(`
      [
        {
          "experimentId": "experiment1",
          "number": 1,
          "runId": "run1",
          "type": "log1",
          "values": {
            "message": "hello",
            "recipient": "Anna",
          },
        },
        {
          "experimentId": "experiment1",
          "number": 5,
          "runId": "run1",
          "type": "log1",
          "values": {
            "message": "bonjour",
            "recipient": "Jo",
          },
        },
      ]
    `);
  });
  it('should resolve with an empty array if no log matches the filter', async () => {
    await expect(
      fromAsync(store.getLogs({ experiment: 'experiment2', type: 'log1' })),
    ).resolves.toEqual([]);
    await expect(
      fromAsync(store.getLogs({ experiment: 'do not exist' })),
    ).resolves.toEqual([]);
    await expect(
      fromAsync(store.getLogs({ run: 'do not exist' })),
    ).resolves.toEqual([]);
    await expect(
      fromAsync(store.getLogs({ type: 'do not exist' })),
    ).resolves.toEqual([]);
  });
});

async function fromAsync<T>(iterable: AsyncIterable<T>) {
  let values: T[] = [];
  for await (let value of iterable) {
    values.push(value);
  }
  return values;
}
