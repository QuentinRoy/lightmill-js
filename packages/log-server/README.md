# @lightmill/log-server

Express middleware and datastore implementation for receiving and querying Lightmill logs.

The package exports:

1. `LogServer(...)`: create API middleware.
2. `SQLiteDataStore`: SQLite-backed `DataStore` implementation.
3. `DataStore` type.

## Install

```sh
npm install @lightmill/log-server express
```

## Usage

```ts
import express from 'express';
import { LogServer, SQLiteDataStore } from '@lightmill/log-server';

const app = express();
const dataStore = new SQLiteDataStore('./lightmill.db');
await dataStore.migrateDatabase();

const { middleware } = LogServer({
  dataStore,
  sessionKeys: ['replace-with-a-secure-secret'],
});

app.use('/api', middleware);
app.listen(3000);
```

## Create an experiment before the first run

Create each experiment once, before a participant calls `startRun` with its
name. The client looks up the experiment; it does not create one. Creating an
experiment with an existing name returns a conflict error.

With the standalone server, create the experiment in the database used by
`log-server start`:

```sh
log-server experiment add pointing-study --database ./data.sqlite
```

The command creates the database if needed. An existing name produces an error
and exit code 1.

If you embed `LogServer`, add the experiment to the datastore after migrating
the database and before accepting runs. Run this setup only once for each name:

```ts
await dataStore.migrateDatabase();
await dataStore.addExperiment({ experimentName: 'pointing-study' });
```

For a running server, create a host session with `POST /sessions` and then
send `POST /experiments` with the session cookie and this body:

```json
{
  "data": { "type": "experiments", "attributes": { "name": "pointing-study" } }
}
```

Set the `Content-Type` header to `application/vnd.api+json`. A host session
uses `role: "host"`; a participant session cannot create experiments. If
`hostPassword` is set, authenticate as `hostUser` (default `host`) when
creating the host session.

## API Reference

### `LogServer(options)`

Creates an object with `middleware: express.RequestHandler`.

Required options:

- `dataStore`: datastore implementation.
- `sessionKeys`: session secret keys.

Common optional options:

- `hostUser`, `hostPassword`
- `allowCrossOrigin`
- `secureCookies`
- `sessionStore`
- `sessionMaxAge` (cookie lifetime in milliseconds)
- `mode`
- `trustProxy`

By default, `LogServer` uses cross-origin cookies, which require HTTPS.
For a page and API served from the same origin over HTTP, set
`allowCrossOrigin: false`. This also turns off secure cookies. Browsers
reject cross-origin cookies without the `Secure` attribute, so
`secureCookies: false` cannot be used with cross-origin cookies.

### Resuming runs after a restart

Participant sessions keep the list of runs they can access. By default,
`LogServer` stores sessions in memory, so restarting the server loses that
list. Run logs in `SQLiteDataStore` remain, but a participant can no longer
find or resume those runs through the client.

If participants need to resume after a server restart when embedding
`LogServer`, pass a persistent `express-session` compatible store as
`sessionStore`, such as the one from
[`SQLiteDataStore#getSessionStore()`](#class-sqlitedatastore). Set
`sessionMaxAge` if the browser cookie must also survive closing and reopening
the browser. Keep `sessionKeys` stable across restarts
so existing cookies remain valid. The keys sign cookies; they do not store
session data.

The standalone `log-server start` command uses `getSessionStore()`, so it
stores sessions in its `--database` SQLite file. It gives its browser cookie a
30-day lifetime by default. Use `--session-max-age-days` or
`SESSION_MAX_AGE_DAYS` to change that lifetime. Existing sessions are lost if
the browser deletes its cookie or if the session signing key changes.

### `class SQLiteDataStore`

SQLite implementation of the `DataStore` interface.

Constructor:

```ts
new SQLiteDataStore(dbPath, {
  logLevel?,
  selectQueryLimit?,
})
```

Implements all `DataStore` methods for experiments, runs, logs, filters, migration, and shutdown.

#### `getSessionStore()`

Returns an `express-session` store that persists sessions in the same SQLite
database, on the data store's connection. Every call returns the same store.

```ts
const dataStore = new SQLiteDataStore('data.sqlite');
await dataStore.migrateDatabase();
LogServer({
  dataStore,
  sessionStore: dataStore.getSessionStore(),
  sessionKeys: ['replace-with-a-secure-secret'],
});
```

- Run `migrateDatabase()` (or `log-server migrate`) before the store is used:
  it creates the session table. Using the store before then fails with an
  error that says so.
- A session lives as long as its cookie, so `sessionMaxAge` sets both. A
  session whose cookie has no expiry lives one day.
- Keep `sessionKeys` stable across restarts so existing cookies remain valid.
- `close()` on the data store ends its session store, and later session
  operations fail. Close the HTTP server first, so no request is in flight.

### `DataStore` type

Contract for custom datastore implementations. Includes methods such as:

- `addExperiment`, `getExperiments`
- `addRun`, `resumeRun`, `setRunStatus`, `getRuns`
- `addLogs`, `getLogs`, `getLastLogs`
- `getLogValueNames`
- `migrateDatabase`, `close`

## CLI

This package also provides a `log-server` binary via package `bin` output.
The `start` command serves only the API and uses the HTTPS defaults.
Pass `--same-origin` only when the browser loads the page and calls the API
from the same origin over HTTP. This can be arranged with a reverse proxy;
the CLI does not serve the page or make a separately hosted page share
the API's origin.

The CLI stores logs and participant sessions in the same database file.
Keep that file and the `--session-key` (or `SESSION_KEY`) stable to allow
resumption after a restart. For example:

```sh
log-server start --database ./data.sqlite --session-key your-secret --session-max-age-days 30
```

`start` exits with an error if the database is missing or has pending
migrations. After upgrading, back up the database file, then run
`log-server migrate --database <path>`.
