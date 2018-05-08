import PouchDB from 'pouchdb';
import pouchdbMemoryAdapter from 'pouchdb-adapter-memory';
import RunLogger from './run-logger';

PouchDB.plugin(pouchdbMemoryAdapter);

// This is used to make sure each test database are different, hence, keeping
// tests are isolated (memory adapter is global and jest run tests in parallel
// so db.destroy won't help isolating the tests).
let lastDbId = -1;

// Init some common test values.
let db;
let getLogId;
beforeEach(() => {
  lastDbId += 1;
  db = new PouchDB(`db-id-${lastDbId}`, { adapter: 'memory' });
  getLogId = jest.fn(x => `mockLog-${x.id}`);
});

// Destroy the database.
afterEach(() => db.destroy());

describe.skip('RunLogger', () => {
  it('creates and initializes the store', async () => {
    // Init the database.
    await db.put({ _id: 'mock/log-id', type: 'foo', measures: 'data' });
    // Init the store.
    await RunLogger(db);
    // Test.
    expect(await db.allDocs({ include_docs: true })).toMatchSnapshot();
  });
});

describe.skip('RunLogger#log', () => {
  it('records a new log when the database is empty', async () => {
    // Init the store.
    const store = await RunLogger(db, { getLogId, logsDBPrefix: 'mock/' });
    await store.log('bar', { type: 'foo', measures: 'data' });
    // Test.
    expect(await db.allDocs({ include_docs: true })).toMatchSnapshot();
    expect(getLogId).toMatchSnapshot();
  });

  it('records a new log when the database is not empty', async () => {
    // Init the database.
    await db.put({ _id: 'mock/mockLog-id', type: 'foo', measures: 'data' });
    // Init the store.
    const store = await RunLogger(db, { getLogId, logsDBPrefix: 'mock/' });
    await store.record('other-log-id', {
      type: 'foo',
      measures: 'other-data'
    });
    // Test.
    expect(await db.allDocs({ include_docs: true })).toMatchSnapshot();
    expect(getLogId).toMatchSnapshot();
  });

  it('refuses to overwrite existing logs', async () => {
    // Init the database.
    await db.put({ _id: 'mock/mockLog-id', type: 'foo', measures: 'data' });
    // Init the store.
    const store = await RunLogger(db, { getLogId, logsDBPrefix: 'mock/' });
    // Test.
    await expect(
      store.record('id', { type: 'bar', measures: 'data' })
    ).toThrow();
    expect(await db.allDocs({ include_docs: true })).toMatchSnapshot();
  });
});

describe.skip('RunLogger#last', () => {
  it('returns the last recorded log when it was recorded with the same RunLogger instance', async () => {
    const store = await RunLogger(db);
    // Do not waiting for the log to be recorded.
    store.record({ type: 'bar', id: 'log-id', measures: { foo: 'bar' } });
    expect(await store.last()).toEqual({
      type: 'bar',
      id: 'log-id',
      measures: { foo: 'bar' }
    });
  });

  it('returns the last recorded log even when it was not recorded with the same RunLogger instance', async () => {
    await db.put({ _id: 'mock/log-id', measures: { foo: 'bar' } });
    const store = await RunLogger(db, { logsDBPrefix: 'mock/' });
    expect(await store.last()).toEqual({ measures: { foo: 'bar' } });
  });

  it('returns undefined if no logs were previously recorded', async () => {
    const store = await RunLogger(db);
    expect(await store.last()).toBe(undefined);
  });
});
