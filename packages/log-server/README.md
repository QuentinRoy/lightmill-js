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
