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

If participants need to resume after a server restart, pass a persistent
`express-session` compatible store as `sessionStore` when creating
`LogServer`. Keep `sessionKeys` stable across restarts so existing cookies
remain valid. The keys sign cookies; they do not store session data. The
`log-server start` command does not currently accept a session store, so
this setup requires using `LogServer` in your own server.

The session cookie has no `maxAge` setting and may be deleted when the
browser closes. If a browser loses its cookie, its participant session
cannot be recovered through the client even when the server uses a
persistent session store.

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

### `DataStore` type

Contract for custom datastore implementations. Includes methods such as:

- `addExperiment`, `getExperiments`
- `addRun`, `resumeRun`, `setRunStatus`, `getRuns`
- `addLogs`, `getLogs`, `getLastLogs`, `getMissingLogs`
- `getLogValueNames`
- `migrateDatabase`, `close`

## CLI

This package also provides a `log-server` binary via package `bin` output.
The `start` command serves only the API and uses the HTTPS defaults.
Pass `--same-origin` only when the browser loads the page and calls the API
from the same origin over HTTP. This can be arranged with a reverse proxy;
the CLI does not serve the page or make a separately hosted page share
the API's origin.
