# @lightmill/log-server

Express middleware and datastore implementation for receiving and querying Lightmill logs.

The package exports:

1. `createLogServer(...)`: API middleware factory.
2. `SQLiteDataStore`: SQLite-backed `DataStore` implementation.
3. `DataStore` type.

## Install

```sh
npm install @lightmill/log-server express
```

## Usage

```ts
import express from 'express';
import { createLogServer, SQLiteDataStore } from '@lightmill/log-server';

const app = express();
await SQLiteDataStore.migrateDatabase('./lightmill.db');
const dataStore = await SQLiteDataStore.open('./lightmill.db');

const { middleware } = createLogServer({
  dataStore,
  sessionKeys: ['replace-with-a-secure-secret'],
  hostPassword: 'replace-with-a-secure-password',
});

app.use('/api', middleware);
app.listen(3000);
```

A host session reads every experiment, run, and log, including the CSV export
from `GET /logs`, creates experiments, and cancels any run. `hostPassword` is
required so that only people who know it can open one: `createLogServer`
throws without it, and `log-server start` exits.

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

If you call `createLogServer` yourself, add the experiment to the datastore
after opening it and before accepting runs. Run this setup only once for each
name:

```ts
await dataStore.withTransaction((tx) =>
  tx.addExperiment({ experimentName: 'pointing-study' }),
);
```

For a running server, create a host session with `POST /sessions` and then
send `POST /experiments` with the session cookie and this body:

```json
{
  "data": { "type": "experiments", "attributes": { "name": "pointing-study" } }
}
```

Set the `Content-Type` header to `application/vnd.api+json`. A host session
uses `role: "host"`; a participant session cannot create experiments. Create the
host session with HTTP Basic authentication, using `hostUser` (default `host`)
and `hostPassword`.

A host session reads every run, but only the session that created a run adds
logs to it or changes it. A host may still cancel any run.

## API Reference

### `createLogServer(options)`

Creates an object with `middleware: express.RequestHandler`.

Required options:

- `dataStore`: datastore implementation.
- `sessionKeys`: session secret keys.
- `hostPassword`: password of the host user. It must not be empty:
  `createLogServer` throws a `TypeError` otherwise.

Common optional options:

- `hostUser` (default `host`)
- `cookieSite` (`'cross-site'` by default, or `'same-site'`)
- `secureCookies` (`'auto'`, `'always'` or `'never'`)
- `sessionStore`
- `sessionMaxAge` (cookie lifetime in milliseconds)
- `trustProxy` (default `false`)

By default, the server uses cross-site cookies (`SameSite=None`), which
require HTTPS. For a page and API on the same site, set
`cookieSite: 'same-site'` (`SameSite=Strict`). The port does not count, so a
page on `localhost:5173` can call an API on `localhost:3000`, but `localhost`
and `127.0.0.1` are different sites. Same-site cookies are `Secure` over HTTPS
and not over HTTP, so development over plain HTTP works. Behind a reverse proxy
that terminates TLS, set `trustProxy` so the server sees HTTPS. That is
`secureCookies: 'auto'`, the same-site default; set `'always'` or `'never'` to
force either. Browsers reject cross-site cookies without `Secure`, so
`cookieSite: 'cross-site'` only allows `'always'`, its default.

`createLogServer` sets no CORS headers. A page on another origin needs the
`cors` package in front of it, with an explicit list of origins and
`credentials: true`: the client sends the session cookie, and browsers refuse
a credentialed response that allows every origin. Expose `Retry-After` too,
or browsers hide it from the page and `log-client` cannot use it to pace its
retries.

```ts
app.use(
  cors({
    origin: ['https://example.org'],
    credentials: true,
    exposedHeaders: ['Retry-After'],
  }),
);
app.use(middleware);
```

`trustProxy` sets Express's `trust proxy`. When `true`, the server believes
the `X-Forwarded-Host`, `X-Forwarded-Proto`, `X-Forwarded-Prefix` and
`X-Forwarded-For` headers: they build the `Location` headers, `req.ip`, and
whether a request counts as secure. Enable it only behind a reverse proxy that
sets them, since a client reaching the server directly could forge them. A
server behind a TLS-terminating proxy needs it, otherwise it sees plain HTTP
requests and `express-session` drops the `Secure` session cookie, which breaks
cross-site sessions.

### Resuming runs after a restart

Participant sessions keep the list of runs they can access. By default,
the server stores sessions in memory, so restarting it loses that list. Run
logs in `SQLiteDataStore` remain, but a participant can no longer find or
resume those runs through the client.

If participants need to resume after a restart of a server you create with
`createLogServer`, pass a persistent `express-session` compatible store as
`sessionStore`, such as the one from
[`SQLiteDataStore#getSessionStore()`](#class-sqlitedatastore). Set
`sessionMaxAge` if the browser cookie must also survive closing and reopening
the browser. Keep `sessionKeys` stable across restarts so existing cookies
remain valid. The keys sign cookies; they do not store session data.

The standalone `log-server start` command uses `getSessionStore()`, so it
stores sessions in its `--database` SQLite file. It gives its browser cookie a
30-day lifetime by default. Use `--session-max-age-days` or
`SESSION_MAX_AGE_DAYS` to change that lifetime. Existing sessions are lost if
the browser deletes its cookie or if the session signing key changes.

### Session stores and concurrent requests

`POST /runs` and `DELETE /sessions/current` change the session, so the server
handles them one at a time for each session. It reads the session again once
its turn comes. A store you pass as `sessionStore` must therefore return what
it just saved when the same process reads it back: once `set` calls back, `get`
returns that data. The memory store, the one from `getSessionStore()`, and
Redis on a single server do. A store that reads from a copy of the data that
can lag behind, or reports a write as done before it can be read, does not.
Nothing checks this.

If the store implements `touch`, it must refresh only an existing session's
expiry and cookie lifetime, preserving its current role and run list. It must
not recreate a deleted session. These guarantees must hold atomically with
concurrent `set` and `destroy` calls: a separate read followed by a write can
still overwrite newer data or restore a deleted session. An older request can
finish after run creation or session deletion and pass its old session data
to `touch`. Stores that save that whole snapshot are not supported. The default
memory store preserves the current session data when it refreshes expiry; the
SQLite session store does not implement `touch`. Custom stores must satisfy
these requirements; the server does not check or enforce them.

Two limits remain:

- Requests are ordered inside one server process. If several processes share a
  session store, two simultaneous `POST /runs` of one session can both succeed.
- If the store fails to save the session after `POST /runs` created the run,
  the request answers `500` and the run belongs to no session. The participant
  can create another run, but the same run name answers `409 RUN_EXISTS` until
  the host cancels the run that has no session with `PATCH /runs/{id}`.

### `class SQLiteDataStore`

SQLite implementation of the `DataStore` interface.

Create it with the static async factory:

```ts
await SQLiteDataStore.open(dbPath, { logLevel?, selectQueryLimit? })
```

`open` throws if the database file does not exist, and a `DataStoreError` with
code `SCHEMA_OUTDATED` if it has pending migrations. Apply them first with
`await SQLiteDataStore.migrateDatabase(dbPath)`, which also creates a missing
database. Back up an existing database first. An in-memory database
(`':memory:'`) is always migrated.

Implements `DataStore`. A transaction takes SQLite's write lock when it
starts, and waits for it up to the driver's default of five seconds before it
rejects with `TRANSACTION_CONFLICT`.

#### `getSessionStore()`

Returns an `express-session` store that persists sessions in the same SQLite
database, on the data store's connection. Every call returns the same store.

```ts
await SQLiteDataStore.migrateDatabase('data.sqlite');
const dataStore = await SQLiteDataStore.open('data.sqlite');
createLogServer({
  dataStore,
  sessionStore: dataStore.getSessionStore(),
  sessionKeys: ['replace-with-a-secure-secret'],
  hostPassword: 'replace-with-a-secure-password',
});
```

- The session table comes from a migration, so `open()` fails with
  `SCHEMA_OUTDATED` until `migrateDatabase()` (or `log-server migrate`) has
  created it.
- A session lives as long as its cookie, so `sessionMaxAge` sets both. A
  session whose cookie has no expiry lives one day.
- `close()` on the data store ends its session store, and later session
  operations fail. Close the HTTP server first, so no request is in flight.

### `DataStore` type

Contract for custom datastore implementations. Reads work anywhere, and every
write goes through `withTransaction`:

- Reads, on the store and inside a transaction: `getExperiments`, `getRuns`,
  `getLogs`, `getLastLogs`, `getLogValueNames`.
- `withTransaction(fn)`: runs `fn` with a `DataStoreTransaction` and resolves
  with what `fn` returns.
- `close()`.

A `DataStoreTransaction` adds the writes `addExperiment`, `addRun`,
`setRunStatus`, `cancelLogsAfter`, and `addLogs`. Run lifecycle rules, like
which status can follow which, are not part of this contract: a custom
datastore only needs to reject what its backend states itself, like a foreign
key or a duplicate run name.

```ts
await dataStore.withTransaction(async (tx) => {
  const run = await tx.addRun({ experimentId, runStatus: 'running' });
  await tx.addLogs(run.runId, [{ type: 'start', number: 1, values: {} }]);
});
```

`withTransaction` guarantees:

- **Isolation.** Transactions are serializable. A transaction that cannot be
  serialized, or waits too long for a lock, rejects with a `DataStoreError`
  with code `TRANSACTION_CONFLICT`, and nothing is persisted. Trying again may
  succeed.
- **Commit and rollback.** `fn` resolving commits, and `fn` throwing rolls
  back and rejects with the same error. Never commit or roll back yourself.
  After a rejected call on the transaction, `fn` must throw: nothing is
  promised about a transaction that kept going.
- **Callback rule.** `fn` must only make calls on its transaction, and await
  each of them. The datastore holds a lock while `fn` runs, and `fn` may run
  again after a conflict. A call still pending when `fn` finishes rolls the
  transaction back and rejects with a `TypeError`.
- **No nesting.** The transaction has no `withTransaction`. In JavaScript,
  calling one throws a `TypeError`.
- **Scope.** Once `fn` finishes, every call on the transaction, and every pull
  of a log generator it returned, rejects with `TRANSACTION_ENDED`.
- **Failed commit or rollback.** A commit that fails rejects with
  `TRANSACTION_COMMIT_FAILED` (`cause` is the commit error), or
  `TRANSACTION_CONFLICT` when it failed from a conflict. A rollback that fails
  rejects with `TRANSACTION_ROLLBACK_FAILED`: `cause` is the rollback error,
  `originalError` is the error that caused the rollback, and what was
  persisted is unknown.
- **Closing.** `close()` rejects new operations with `STORE_CLOSED` at once,
  waits for the ones in flight, then releases the connection. It can be
  called many times. Calling it inside `fn` deadlocks. The creator of a
  datastore closes it: `createLogServer` never closes the one it is given.

The documented `DataStoreError` codes are the same for every datastore, and a
driver error is their `cause`. A failure with no documented code propagates
unchanged.

`SQLiteDataStore` also has a `[Symbol.asyncDispose]()` method that calls
`close()`, so a script can write
`await using store = await SQLiteDataStore.open(path)`. The `DataStore`
contract does not require it. That syntax needs TypeScript 5.2 or later. Type
declarations reference the `esnext.disposable` library, so type-only consumers
need nothing more.

## CLI

This package also provides a `log-server` binary via package `bin` output.
The `start` command serves only the API and uses the HTTPS defaults.
A page on another origin can only call it if the server names that page.
Pass `--allowed-origin <origin>` once per page, or set `ALLOWED_ORIGINS` to a
comma-separated list, for example `https://example.org`. The server then
answers those origins with credentials allowed, and no others. Without an
allowed origin or `--same-site`, `start` exits with an error. It rejects
`*` and any value with a path or trailing slash, because browsers never send
those.

Cookies need HTTPS unless the page and the API are on the same site. For
development over HTTP, pass `--same-site` and `--allowed-origin`:

```sh
log-server start --same-site --allowed-origin http://localhost:5173 --host-password your-password
```

`--same-site` covers any page on the same site, so a page on `localhost:5173`
can call an API on `localhost:3000`: the port does not count. `localhost` and
`127.0.0.1` are different sites. Cookies are `Secure` over HTTPS and not over
HTTP. Use `--same-site` alone when a reverse proxy serves the page and the API
from one origin. The CLI does not serve the page or make a separately hosted
page share the API's origin.
Pass `--trust-proxy` when the server runs behind a reverse proxy that
terminates TLS (see `trustProxy` above).

The CLI stores logs and participant sessions in the same database file.
Keep that file and the `--session-key` (or `SESSION_KEY`) stable to allow
resumption after a restart. For example:

```sh
log-server start --database ./data.sqlite --session-key your-secret --host-password your-password --allowed-origin https://example.org --session-max-age-days 30
```

`start` exits with an error if it has no host password. Set it with
`--host-password` or the `HOST_PASSWORD` environment variable. The host user
is `host`.

`start` exits with an error if the database is missing or has pending
migrations. After upgrading, back up the database file, then run
`log-server migrate --database <path>`.
