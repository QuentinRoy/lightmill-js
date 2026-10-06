# @lightmill/log-server

The LightMill log server: it receives the logs that [`@lightmill/log-client`](../log-client/README.md) sends from participants' browsers, stores them in SQLite, and exports them as CSV.

Run it on its own with the `log-server` command, or mount it in your own Express app with `createLogServer`.

## Install

```sh
npm install @lightmill/log-server
```

It needs Node.js 24.12 or later.

## Quick start

Put the two secrets the server needs in a `.env` file, in the directory you run it from:

```sh
SESSION_KEY=change-me-to-a-long-random-string
HOST_PASSWORD=change-me-too
```

Create the database and an experiment, then start the server:

```sh
npx log-server migrate
npx log-server experiment add my-experiment
npx log-server start --same-site --allowed-origin http://localhost:5173
```

The server listens on port 3000 and accepts requests from a page served on `http://localhost:5173`. Once participants have logged something, export the logs:

```sh
npx log-server export > logs.csv
```

- [Getting started](../../docs/guides/getting-started.md) builds a complete experiment around this server.
- [Deploying](../../docs/guides/deploying.md) explains which flags to use online, and how to run, back up, and upgrade the server.
- [Exporting data](../../docs/guides/exporting-data.md) describes the CSV format.

## Command line

Every command takes `--database <path>` (`-d`), which defaults to the `DB_PATH` environment variable, or `./data.sqlite`. The command reads environment variables from a `.env` file in the current directory too.

### `log-server start`

Starts the server. It exits with an error when the database is missing or has pending migrations, when it has no session key or host password, or when it has no allowed origin and no `--same-site`.

| Option                    | Environment variable   | Description                                                                                                                                           |
| ------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--port`, `-p`            | `PORT`                 | Port to listen on. Defaults to `3000`.                                                                                                                |
| `--session-key`, `-s`     | `SESSION_KEY`          | Secret that signs the session cookies. Required. Separate several keys with `:` to rotate them.                                                       |
| `--host-password`, `-w`   | `HOST_PASSWORD`        | Password of the host user, `host`. Required.                                                                                                          |
| `--allowed-origin`        | `ALLOWED_ORIGINS`      | Origin of a page allowed to call the server, such as `https://example.org`. Repeat it for several origins; the variable takes a comma-separated list. |
| `--same-site`             |                        | The page is on the same site as the server. Lets cookies work over plain HTTP.                                                                        |
| `--trust-proxy`           |                        | Trust the `X-Forwarded-*` headers of a reverse proxy.                                                                                                 |
| `--secure-cookies <mode>` |                        | `auto`, `always`, or `never`. See [Cookies](#cookies).                                                                                                |
| `--session-max-age-days`  | `SESSION_MAX_AGE_DAYS` | How long a participant's session lasts. Defaults to `30`.                                                                                             |
|                           | `LOG_LEVEL`            | `trace`, `debug`, `info`, `warn`, or `error`. Defaults to `info`.                                                                                     |

An allowed origin has a scheme, a host, and an optional port, but no path or trailing slash: browsers never send those, so the server rejects them, along with `*`. `start` serves the API only, at the root of the server; it does not serve your app.

The server stores logs and participant sessions in the same database, so participants can resume their runs after a restart, as long as the database and the session key stay the same. On `SIGTERM`, it finishes the requests in progress and closes the database.

### `log-server migrate`

Creates the database if needed, and applies pending migrations. Back up an existing database first.

### `log-server experiment add <name>`

Creates an experiment. Participants can only start runs in experiments that exist. It creates and migrates the database if needed, and fails when an experiment with that name exists.

### `log-server export`

Writes the logs as CSV to the standard output. Canceled runs are left out.

| Option                    | Description                                                   |
| ------------------------- | ------------------------------------------------------------- |
| `--experiment-name`, `-e` | Only export logs of this experiment.                          |
| `--log-type`, `-t`        | Only export logs of this type.                                |
| `--output`, `-o`          | Write the CSV to this file and show progress in the terminal. |

To save a file from an interactive terminal:

```sh
npx log-server export --output logs.csv
```

For scripts, redirect standard output instead: `--output` uses terminal controls for its progress display.

```sh
npx log-server export > logs.csv
```

## Hosts and participants

The server knows two roles. Each browser gets a session, identified by a cookie:

- A **participant** session is created by `log-client` when it starts a run. It reads and writes only the runs it created.
- A **host** session is for the researcher. It reads every experiment, run, and log, creates experiments, and cancels any run, for example to free the name of a run whose participant lost their session. It can't add logs to runs it didn't create. Opening a host session takes the host password, with HTTP Basic authentication, user `host`.

Keep the host password secret, and only send it over HTTPS.

## Embedding the server

`createLogServer` returns an Express middleware that serves the API. Use it to add your own routes, serve your app from the same server, or use another datastore.

```sh
npm install @lightmill/log-server express
npm install --save-dev @types/express
```

```ts
import { createLogServer, SQLiteDataStore } from '@lightmill/log-server';
import express from 'express';

const sessionKey = process.env.SESSION_KEY;
const hostPassword = process.env.HOST_PASSWORD;
if (sessionKey == null || hostPassword == null) {
  throw new Error('Set SESSION_KEY and HOST_PASSWORD.');
}

await SQLiteDataStore.migrateDatabase('./data.sqlite');
const dataStore = await SQLiteDataStore.open('./data.sqlite');

const { middleware } = createLogServer({
  dataStore,
  sessionStore: dataStore.getSessionStore(),
  sessionKeys: [sessionKey],
  hostPassword,
  cookieSite: 'same-site',
});

const app = express();
app.use('/api', middleware);
app.use(express.static('dist'));
app.listen(3000);
```

The package works with Express 5. Its types use Express's, from `@types/express`.

### `createLogServer(options)`

| Option          | Default                 | Description                                                                                                                             |
| --------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `dataStore`     | required                | Where logs are stored. `createLogServer` never closes it.                                                                               |
| `sessionKeys`   | required                | Secrets that sign the session cookies. The first one signs; all are accepted, so you can rotate them.                                   |
| `hostPassword`  | required                | Password of the host user. `createLogServer` throws a `TypeError` when it is missing or empty.                                          |
| `hostUser`      | `'host'`                | User name of the host.                                                                                                                  |
| `cookieSite`    | `'cross-site'`          | `'same-site'` when the page and the server are on the same site. See [Cookies](#cookies).                                               |
| `secureCookies` | depends on `cookieSite` | `'auto'`, `'always'`, or `'never'`. See [Cookies](#cookies).                                                                            |
| `sessionStore`  | in memory               | An `express-session` store. The default loses sessions on restart. See [Resuming runs after a restart](#resuming-runs-after-a-restart). |
| `sessionMaxAge` | none                    | Lifetime of the session cookie, in milliseconds. Without it, the cookie goes away when the browser closes.                              |
| `trustProxy`    | `false`                 | Trust the `X-Forwarded-*` headers of a reverse proxy. See [Behind a reverse proxy](#behind-a-reverse-proxy).                            |

The middleware works under any mount path, such as `/api` above.

### Cookies

By default, the session cookie is cross-site (`SameSite=None`), which browsers only accept over HTTPS, with the `Secure` attribute. When the page is on another site, it is a third-party cookie: Safari blocks it by default, and other browsers let people block it. Prefer serving the page and the server from the same site, and set `cookieSite: 'same-site'` (`SameSite=Strict`).

Two addresses are on the same site when they share the scheme (`http` or `https`) and registrable domain (the domain someone can register, such as `example.org`). The port does not count: a page on `localhost:5173` can call a server on `localhost:3000`. `localhost` and `127.0.0.1` are different sites. [Deploying](../../docs/guides/deploying.md#choose-where-the-app-and-the-server-live) compares sites with origins, which also include the hostname and port.

`secureCookies` sets the `Secure` attribute:

- `'auto'`, the same-site default: `Secure` over HTTPS, not over HTTP, so development over plain HTTP works. Behind a proxy that handles HTTPS, set `trustProxy` so the server sees HTTPS.
- `'always'`: only set the cookie when the server recognizes HTTPS, and always mark it `Secure`. The only value cross-site cookies allow, and their default. Behind a proxy, this still needs `trustProxy` and `X-Forwarded-Proto: https`.
- `'never'`: never `Secure`.

### Cross-origin requests

`createLogServer` sets no headers that allow browser code on another origin to read its responses. A page on another origin needs the `cors` package in front of the middleware, with an explicit list of origins and `credentials: true`: the client sends the session cookie, and browsers refuse a response that allows every origin when cookies are involved. Expose `Retry-After` too, or browsers hide it from the page and `log-client` can't use it to pace its retries.

```ts
import cors from 'cors';

app.use(
  '/api',
  cors({
    origin: ['https://study.example.org'],
    credentials: true,
    exposedHeaders: ['Retry-After'],
  }),
  middleware,
);
```

### Behind a reverse proxy

`trustProxy` sets Express's `trust proxy`. With `true`, the server believes the `X-Forwarded-Host`, `X-Forwarded-Proto`, `X-Forwarded-Prefix`, and `X-Forwarded-For` headers: they decide the links in `Location` headers, `req.ip`, and whether a request came over HTTPS. Only turn it on behind a proxy that sets these headers, since a client reaching the server directly could forge them. Without it, a server behind a proxy that handles HTTPS sees plain HTTP requests, and drops `Secure` cookies.

### Creating experiments in code

Add experiments to the datastore before participants start runs, once per name. Adding an existing name throws a `DataStoreError` with code `EXPERIMENT_EXISTS`.

```ts
await dataStore.withTransaction((tx) =>
  tx.addExperiment({ experimentName: 'my-experiment' }),
);
```

A host can also create one over HTTP, with `POST /experiments`.

### Resuming runs after a restart

Participants find their runs through their session. The default session store keeps sessions in memory, so a restart loses them: the logs remain, but participants can no longer find or resume their runs.

To keep sessions across restarts, pass a persistent `express-session` store as `sessionStore`, such as [`dataStore.getSessionStore()`](#getsessionstore). Set `sessionMaxAge` so the cookie also survives the browser closing, and keep `sessionKeys` stable so existing cookies stay valid. The keys sign cookies; they don't store session data.

## HTTP API

The server speaks [JSON:API](https://jsonapi.org), with the `application/vnd.api+json` media type. [`@lightmill/log-api`](../log-api/README.md) has the full OpenAPI description.

| Route                                   | Who             | Does                                                                             |
| --------------------------------------- | --------------- | -------------------------------------------------------------------------------- |
| `POST /sessions`                        | anyone          | Opens a participant session, or a host session with the host password.           |
| `GET`, `DELETE /sessions/current`       | session         | Reads or closes the current session.                                             |
| `GET /experiments`, `/experiments/{id}` | session         | Reads experiments.                                                               |
| `POST /experiments`                     | host            | Creates an experiment.                                                           |
| `POST /runs`                            | session         | Starts a run in an experiment.                                                   |
| `GET /runs`, `/runs/{id}`               | session         | Reads the session's runs; a host reads every run.                                |
| `PATCH /runs/{id}`                      | run owner, host | Changes a run's status, or resumes it. A host can only cancel.                   |
| `POST /logs`                            | run owner       | Adds one log.                                                                    |
| `POST /operations`                      | run owner       | Adds a batch of logs, with the JSON:API Atomic Operations extension.             |
| `GET /logs`                             | session         | Reads logs as CSV by default, or as JSON when requested. A host reads every log. |
| `GET /logs/{id}`                        | session         | Reads one log as JSON. A host can read any log.                                  |

## `SQLiteDataStore`

The SQLite datastore, which the command line uses.

```ts
await SQLiteDataStore.migrateDatabase(path);
const dataStore = await SQLiteDataStore.open(path, options);
```

- `migrateDatabase(path)` creates the database if needed and applies pending migrations. Back up an existing database first.
- `open(path, { logLevel?, selectQueryLimit? })` throws when the file does not exist, and throws a `DataStoreError` with code `SCHEMA_OUTDATED` when migrations are pending. `logLevel` is the `loglevel` level of its SQL and error logs. `selectQueryLimit` is the number of logs read per query when streaming logs, 1,000,000 by default. An in-memory database (`':memory:'`) is always migrated.
- `close()` waits for operations in progress, then closes the database. Close the HTTP server first.
- `await using dataStore = await SQLiteDataStore.open(path)` closes it at the end of the scope (TypeScript 5.2 or later).

A transaction takes SQLite's write lock when it starts, and waits for it up to five seconds before it rejects with `TRANSACTION_CONFLICT`.

### `getSessionStore()`

Returns an `express-session` store that keeps sessions in the same database, on the datastore's connection. Every call returns the same store.

- The session table comes from a migration, so `open()` fails with `SCHEMA_OUTDATED` until `migrateDatabase()`, or `log-server migrate`, has created it.
- A session lasts as long as its cookie, so `sessionMaxAge` sets both. A session whose cookie has no expiry lasts one day.
- Closing the datastore ends its session store, and later session operations fail.

## Advanced

### Session stores and concurrent requests

`POST /runs` and `DELETE /sessions/current` change the session, so the server handles them one at a time for each session, and reads the session again once its turn comes. A store you pass as `sessionStore` must therefore return what it just saved when the same process reads it back: once `set` calls back, `get` returns that data. The memory store, the one from `getSessionStore()`, and Redis on a single server do. A store that reads from a copy of the data that can lag behind, or reports a write as done before it can be read, does not. Nothing checks this.

If the store implements `touch`, it must refresh only an existing session's expiry and cookie lifetime, preserving its current role and run list, and must not recreate a deleted session. These guarantees must hold atomically with concurrent `set` and `destroy` calls: a separate read followed by a write can still overwrite newer data or restore a deleted session. An older request can finish after run creation or session deletion and pass its old session data to `touch`, so stores that save that whole snapshot are not supported. The default memory store preserves the current session data when it refreshes expiry; the SQLite session store does not implement `touch`. The server does not check these requirements.

Two limits remain:

- Requests are ordered inside one server process. If several processes share a session store, two simultaneous `POST /runs` of one session can both succeed.
- If the store fails to save the session after `POST /runs` created the run, the request answers `500` and the run belongs to no session. The participant can create another run, but the same run name answers `409 RUN_EXISTS` until a host cancels the run that has no session with `PATCH /runs/{id}`.

### Custom datastores

`DataStore` is the interface a datastore implements, for example to store logs in another database. Reads work anywhere, and every write goes through `withTransaction`:

- Reads, on the store and inside a transaction: `getExperiments`, `getRuns`, `getLogs`, `getLastLogs`, `getLogValueNames`.
- `withTransaction(fn)` runs `fn` with a `DataStoreTransaction` and resolves with what `fn` returns. The transaction adds the writes `addExperiment`, `addRun`, `setRunStatus`, `cancelLogsAfter`, and `addLogs`.
- `close()`.

Run lifecycle rules, like which status can follow which, are not part of this contract: the server applies them. A datastore only rejects what its backend states itself, like a foreign key or a duplicate run name. Code that calls a datastore directly can therefore write any status.

```ts
await dataStore.withTransaction(async (tx) => {
  const run = await tx.addRun({ experimentId, runStatus: 'running' });
  await tx.addLogs(run.runId, [{ type: 'start', number: 1, values: {} }]);
});
```

`withTransaction` guarantees:

- **Isolation.** Transactions are serializable. A transaction that can't be serialized, or waits too long for a lock, rejects with a `DataStoreError` with code `TRANSACTION_CONFLICT`, and nothing is persisted. Trying again may succeed.
- **Commit and rollback.** `fn` resolving commits, and `fn` throwing rolls back and rejects with the same error. Never commit or roll back yourself. After a rejected call on the transaction, `fn` must throw: nothing is promised about a transaction that kept going.
- **Callback rule.** `fn` must only make calls on its transaction, and await each of them. The datastore holds a lock while `fn` runs, and `fn` may run again after a conflict. A call still pending when `fn` finishes rolls the transaction back and rejects with a `TypeError`.
- **No nesting.** The transaction has no `withTransaction`. In JavaScript, calling one throws a `TypeError`.
- **Scope.** Once `fn` finishes, every call on the transaction, and every pull of a log generator it returned, rejects with `TRANSACTION_ENDED`.
- **Failed commit or rollback.** A commit that fails rejects with `TRANSACTION_COMMIT_FAILED` (`cause` is the commit error), or `TRANSACTION_CONFLICT` when it failed from a conflict. A rollback that fails rejects with `TRANSACTION_ROLLBACK_FAILED`: `cause` is the rollback error, `originalError` is the error that caused the rollback, and what was persisted is unknown.
- **Closing.** `close()` rejects new operations with `STORE_CLOSED` at once, waits for the ones in flight, then releases the connection. It can be called many times. Calling it inside `fn` deadlocks. Whoever creates a datastore closes it.

### `DataStoreError`

Every datastore throws a `DataStoreError` with the same `code` for the same failure, with the driver's error as `cause`. A failure with no code below propagates unchanged.

| Code                            | Meaning                                                                |
| ------------------------------- | ---------------------------------------------------------------------- |
| `EXPERIMENT_EXISTS`             | An experiment with this name exists.                                   |
| `RUN_EXISTS`                    | A run that isn't canceled has this name in the experiment.             |
| `LOG_NUMBER_EXISTS_IN_SEQUENCE` | A log with this number exists. `logNumber` is the number.              |
| `EXPERIMENT_NOT_FOUND`          | No experiment has this id.                                             |
| `RUN_NOT_FOUND`                 | No run has this id.                                                    |
| `LOG_NOT_FOUND`                 | No log has this id.                                                    |
| `TRANSACTION_CONFLICT`          | The transaction couldn't be serialized, or waited too long for a lock. |
| `TRANSACTION_ENDED`             | A call on a transaction after its callback finished.                   |
| `TRANSACTION_COMMIT_FAILED`     | The commit failed.                                                     |
| `TRANSACTION_ROLLBACK_FAILED`   | The rollback failed. `originalError` is what caused it.                |
| `STORE_CLOSED`                  | A call after `close()`.                                                |
| `MIGRATION_FAILED`              | A migration failed.                                                    |
| `SCHEMA_OUTDATED`               | The database has pending migrations.                                   |
