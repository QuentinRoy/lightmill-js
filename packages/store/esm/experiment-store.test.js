import PouchDB from 'pouchdb';
import pouchdbMemoryAdapter from 'pouchdb-adapter-memory';
import ExperimentStore from './experiment-store';

PouchDB.plugin(pouchdbMemoryAdapter);

// Create an experiment ID, making sure that all tests have a different one.
// The experiment IDs are used to compute the database's id. This mak sure that
// a different database is used for each tests (memory adapter is global and
// jest run tests in parallel so db.destroy won't help isolating the tests).
let experimentId = 0;
let getExperimentDB;
let getRunStoreDB;
let getRunStore;
beforeEach(() => {
  experimentId += 1;
  getExperimentDB = jest.fn(
    experimentId_ =>
      new PouchDB(`mock-experiment-db-${experimentId_}`, { adapter: 'memory' })
  );
  getRunStoreDB = jest.fn(() => 'mock-store-db');
  getRunStore = jest.fn(() => 'mock-run-store');
});

// Destroy every databases created during the test.
afterEach(() =>
  Promise.all(getExperimentDB.returnValues.map(db => db.destroy())));

describe.skip('ExperimentStore', async () => {
  it('properly initializes the store and returns it when the database does not exist', async () => {
    ExperimentStore({ experimentId, getExperimentDB });
    expect(getExperimentDB).toMatchSnapshot();
    const experimentDB = getExperimentDB.mock.returnValues[0];
    expect(
      await experimentDB.allDocs({ include_docs: true })
    ).toMatchSnapshot();
  });
  it('properly initializes the store and returns it when the database exists', async () => {
    // Init the database.
    const initExperimentDB = getExperimentDB(experimentId);
    await initExperimentDB.put({ _id: 'run/mock-run', runId: 'mock-run' });

    // Same thing as previous test.
    ExperimentStore({ experimentId, getExperimentDB });
    // In theory, this should be the same database as initExperimentDB.
    const experimentDB = getExperimentDB.mock.returnValues[1];
    expect(
      await experimentDB.allDocs({ include_docs: true })
    ).toMatchSnapshot();
  });
});

describe.skip('ExperimentStore#getRunStoreIds', () => {
  it('returns an empty list if no store were recorded', async () => {
    // Init the database.
    const initExperimentDB = getExperimentDB(experimentId);
    await initExperimentDB.bulkDocs([{ _id: 'some-unknown-record' }]);
    // Test.
    expect(
      ExperimentStore({ experimentId, getExperimentDB }).getRunRecords()
    ).resolves.toEqual([]);
  });
  it('returns the list of the ids of the created runs', async () => {
    // Init the database.
    const initExperimentDB = getExperimentDB(experimentId);
    await initExperimentDB.bulkDocs([
      { _id: 'run/1', runId: 'mock-run-1' },
      { _id: 'run/2', runId: 'mock-run-2' },
      { _id: 'some-unknown-record' }
    ]);
    // Test.
    expect(
      ExperimentStore({ experimentId, getExperimentDB }).getRunStoreIds()
    ).resolves.toEqual(['mock-run-1', 'mock-run-2']);
  });
});

describe.skip('ExperimentStore#loadRunStore', () => {
  it('returns the store corresponding to a run if a record for this run exists', async () => {
    // Init the database.
    const initExperimentDB = getExperimentDB(experimentId);
    await initExperimentDB.put({ _id: 'run/1', runId: 'mock-run' });

    // Load the store.
    await expect(
      ExperimentStore({
        experimentId,
        getExperimentDB,
        getRunStoreDB,
        getRunStore
      }).loadRunStore('mock-run')
    ).resolves.toBe('old-mock-run-store');

    // Check that getRunStoreDB and getRunStore had been properly called.
    expect(getRunStoreDB.mock.calls.length).toBe(1);
    expect(getRunStoreDB.mock.calls[0]).toEqual([experimentId, 'mock-run']);
    expect(getRunStore.mock.calls.length).toBe(1);
    expect(getRunStore.mock.calls[0]).toEqual([
      getRunStoreDB.mock.returnValues[0]
    ]);

    // Check that the experiment db did not change.
    expect(
      await getExperimentDB.returnValues[0].allDocs({ include_docs: true })
    ).toMatchSnapshot();
  });

  it('fails if a record for the run does not exist', async () => {
    // Try to load a store that does not exists.
    await expect(
      ExperimentStore({
        experimentId,
        getExperimentDB,
        getRunStoreDB,
        getRunStore
      }).loadRunStore('another-run')
    ).rejects.toThrow('Error: Cannot find the RunStore "another-run".');

    // Check that getRunStoreDB and getRunStore hasn't been called.
    expect(getRunStoreDB.mock.calls.length).toBe(0);
    expect(getRunStore.mock.calls.length).toBe(0);

    // Check that the experiment db did not change.
    expect(
      await getExperimentDB.returnValues[0].allDocs({ include_docs: true })
    ).toMatchSnapshot();
  });
});

describe.skip('ExperimentStore#createRunStore', () => {
  it('creates a new record and returns the corresponding store if a record for this run did not exist yet', async () => {
    // Init the database.
    const initExperimentDB = getExperimentDB(experimentId);
    await initExperimentDB.put({ _id: 'run/1', runId: 'mock-run' });

    // Load the store.
    await expect(
      ExperimentStore({
        experimentId,
        getExperimentDB,
        getRunStoreDB,
        getRunStore
      }).createRunStore('new-mock-run')
    ).resolves.toBe('new-mock-run-store');

    // Check that getRunStoreDB and getRunStore has been properly called.
    expect(getRunStoreDB.mock.calls.length).toBe(1);
    expect(getRunStoreDB.mock.calls[0]).toEqual([experimentId, 'new-mock-run']);
    expect(getRunStore.mock.calls.length).toBe(1);
    expect(getRunStore.mock.calls[0]).toEqual([
      getRunStoreDB.mock.returnValues[0]
    ]);

    // Check that the new record has been registered.
    expect(
      await getExperimentDB.returnValues[0].allDocs({ include_docs: true })
    ).toMatchSnapshot();
  });

  it('fails if a record for this run already exists', async () => {
    // Init the database.
    const initExperimentDB = getExperimentDB(experimentId);
    await initExperimentDB.put({ _id: 'run/1', runId: 'mock-run' });

    // Load the store.
    await expect(
      ExperimentStore({
        experimentId,
        getExperimentDB,
        getRunStoreDB,
        getRunStore
      }).createRunStore('mock-run')
    ).rejects.toThrow('Error: The RunStore "another-run" already exists.');

    // Check that getRunStoreDB and getRunStore hasn't been called.
    expect(getRunStoreDB.mock.calls.length).toBe(0);
    expect(getRunStore.mock.calls.length).toBe(0);

    // Check that the experiment db did not change.
    expect(
      await getExperimentDB.returnValues[0].allDocs({ include_docs: true })
    ).toMatchSnapshot();
  });
});
