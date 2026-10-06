# @lightmill/log-server

## 5.0.0

### Major Changes

- [#407](https://github.com/QuentinRoy/lightmill-js/pull/407) [`bc0b41b`](https://github.com/QuentinRoy/lightmill-js/commit/bc0b41b145c70b7332da4b4b70e5d4689236ade2) - Rename `LogServer` to `createLogServer`. It is a plain function, not a class, so the capital letter suggested `new`. Replace `LogServer(options)` with `createLogServer(options)` and update the import.

- [#431](https://github.com/QuentinRoy/lightmill-js/pull/431) [`4c75e60`](https://github.com/QuentinRoy/lightmill-js/commit/4c75e600111d5c69c57224cd9efebada4424f35a) - Remove the `baseUrl` option of `createLogServer`. The server now reads the path it is mounted on from Express, nested mounts included, and, with `trustProxy`, from the `X-Forwarded-Prefix` header, like it does for `X-Forwarded-Host` and `X-Forwarded-Proto`. This fixes the `Location` header of `POST /sessions`, `/experiments`, `/runs`, and `/logs`, which left out the mount path: mounted with `app.use('/api', middleware)`, creating a session answered `http://host/sessions/current` instead of `http://host/api/sessions/current`. Remove `baseUrl` from your options. If a proxy strips a path prefix before forwarding, have it send `X-Forwarded-Prefix` and set `trustProxy`.

- [#445](https://github.com/QuentinRoy/lightmill-js/pull/445) [`24a14c7`](https://github.com/QuentinRoy/lightmill-js/commit/24a14c7e7828600899ad95ca51cd19522c8301d4) - `createLogServer` requires a `hostPassword` option, and `log-server start` requires `--host-password` or the `HOST_PASSWORD` environment variable. Without one, anyone could open a host session, read every experiment, run and log, create experiments and cancel any run. `createLogServer` throws a `TypeError` and `log-server start` exits with an error if the password is missing or empty. Pass a non-empty password to both. A repeated `--host-password` takes its last value.

- [#455](https://github.com/QuentinRoy/lightmill-js/pull/455) [`29c16f3`](https://github.com/QuentinRoy/lightmill-js/commit/29c16f3ec07b0ad0765a828f9ab0a1b74ed41055) - Rename the `allowCrossOrigin` option of `createLogServer` to `cookieSite`: replace `allowCrossOrigin: false` with `cookieSite: 'same-site'`, and `true` (the default) with `'cross-site'`. The old name suggested the page had to share the API's origin, but cookies only need the same site. `secureCookies` takes `'auto'`, `'always'` or `'never'` instead of a boolean: replace `true` with `'always'` and `false` with `'never'`. Same-site cookies now default to `'auto'`, `Secure` over HTTPS and not over HTTP, where `allowCrossOrigin: false` used to make them never `Secure`; behind a reverse proxy that terminates TLS, set `trustProxy` so the server sees HTTPS. To keep the old behavior, pass `secureCookies: 'never'`. Cross-site cookies, which browsers reject without `Secure`, only accept `'always'`.

- [#400](https://github.com/QuentinRoy/lightmill-js/pull/400) [`e839348`](https://github.com/QuentinRoy/lightmill-js/commit/e839348fd81a455618cc03d914d6ff67ba571d68) - Require Node 24.12 or later. Node 22 and Node 24.0 to 24.11 are no longer supported. Node 24 is the current long-term support release, and 24.12 is the first release where Node marks its TypeScript support as stable. Upgrade Node, or stay on the previous release of this package.

- [#349](https://github.com/QuentinRoy/lightmill-js/pull/349) [`65c9401`](https://github.com/QuentinRoy/lightmill-js/commit/65c94018aa44e3269d7d4cd715c51ebc62bbc17e) - `new SQLiteDataStore(path)` can no longer be called: use `await SQLiteDataStore.open(path, options)`. It throws a `DataStoreError` with code `SCHEMA_OUTDATED` when the database has pending migrations, instead of failing on the first query that needs them, and throws when the file does not exist instead of creating it. To create or migrate a database, run `await SQLiteDataStore.migrateDatabase(path)` first. As an exception, an in-memory database (`':memory:'`) is migrated automatically. The `migrateDatabase()` instance method is removed from `SQLiteDataStore` and from the `DataStore` interface: custom implementations no longer need it. `DataStoreError` is now exported, so embedders can catch it.

- [#375](https://github.com/QuentinRoy/lightmill-js/pull/375) [`2c96c24`](https://github.com/QuentinRoy/lightmill-js/commit/2c96c24d0c2a8749ff94a6a9854c15dc2a80cdeb) - `POST /runs` let a session create a run while it held an `idle` run. It now answers `403 ONGOING_RUNS`, as it does for a `running` or `interrupted` run, since an idle run has not ended. Start or cancel the idle run before creating another.

- [#314](https://github.com/QuentinRoy/lightmill-js/pull/314) [`299fd2b`](https://github.com/QuentinRoy/lightmill-js/commit/299fd2b08895c944e0ec6524f5e07bc7c540c798) - A log number far ahead of a run's other logs no longer crashes the server. `DataStore#getMissingLogs` is removed, since listing every missing log number is what made such logs crash it: read `firstMissingLogNumber` and `lastLogNumber` from `DataStore#getRuns` records instead, and provide them in custom `DataStore` implementations.

- [#424](https://github.com/QuentinRoy/lightmill-js/pull/424) [`b428732`](https://github.com/QuentinRoy/lightmill-js/commit/b4287327e077a05a329d8207d84dc946474d1b4c) - `createLogServer` no longer takes a `mode` option and no longer validates its responses. With a `mode` other than `production` (the default came from `NODE_ENV`), the server checked each response against the API schema and answered `500 INTERNAL_SERVER_ERROR` to any it rejected, so stored data the schema did not expect, such as an experiment with an empty name, broke every request that read it. Remove `mode` from your options.

- [#374](https://github.com/QuentinRoy/lightmill-js/pull/374) [`8c93c4d`](https://github.com/QuentinRoy/lightmill-js/commit/8c93c4d00b90160c911f19b7e7ac388f53d6af33) - Some requests the server used to accept now fail. `POST /runs` only creates `idle` or `running` runs, and answers `403 INVALID_RUN_STATUS` for any other status. `PATCH /runs/{id}` answers `400 INVALID_REQUEST_BODY` when `lastLogNumber` comes with a status other than `running`, and `403 INVALID_LAST_LOG_NUMBER` when it comes without a status on a run that is not running: it used to resume the run if `lastLogNumber` was the run's last log number, even with the status `completed`. A `name` or an `experiment` relationship that differs from the run's answers `403 IMMUTABLE_RUN_ATTRIBUTE`, with a `source.pointer` to the offending attribute, instead of being ignored. Completing an already completed run succeeds even if a log number is missing. Logs are stored only if the run is running when they are written: a run that ended since the request arrived stores none, and `POST /logs` and `POST /operations` answer `403 INVALID_RUN_STATUS` where they could fail with a `500`.
  
  The server, not the database, now enforces these rules, in the same transaction as the writes they guard, so a custom `DataStore` does not have to implement them. Update clients that create completed runs, send a `lastLogNumber` without resuming, or send a different `name` or `experiment` in a `PATCH`.
  
  Upgrading applies a database migration that removes the triggers enforcing the lifecycle and makes run names unique among runs that are not canceled: back up the database, then run `log-server migrate`. It cannot be undone. To go back, restore the backup. It stops, and lists the runs, if two runs of an experiment that are not canceled share a name: fix them by hand, then migrate again.

- [#396](https://github.com/QuentinRoy/lightmill-js/pull/396) [`bbcb236`](https://github.com/QuentinRoy/lightmill-js/commit/bbcb236a538f3b185bde94da31c95fcd78b49d1e) - Only the session that created a run can add logs to it or change it, so two clients can no longer write to the same run. A host session used to write to any run: `POST /logs`, `POST /operations` and `PATCH /runs/{id}` now answer `403 RUN_NOT_OWNED` when it writes to a run another session created. A host can still read every run, and cancel any run with `PATCH /runs/{id}`. Write to a run from the session that created it.

- [#375](https://github.com/QuentinRoy/lightmill-js/pull/375) [`2c96c24`](https://github.com/QuentinRoy/lightmill-js/commit/2c96c24d0c2a8749ff94a6a9854c15dc2a80cdeb) - A custom session store must return what it just saved when the same process reads it back: once `set` calls back, `get` returns that data. `POST /runs` and `DELETE /sessions/current` now read the session again after waiting for their turn, and use what the store returns. A store that reads from a copy of the data that can lag behind, or reports a write as done before it can be read, would give them an old session. If the store implements `touch`, it must only refresh the expiry of an existing session, atomically: an older request can call `touch` with stale session data after a run was created or the session deleted, and saving that data would erase the run or bring the session back. The memory store and `SQLiteDataStore#getSessionStore()` are fine. If your store cannot promise this, use one of those instead.

- [#345](https://github.com/QuentinRoy/lightmill-js/pull/345) [`9270245`](https://github.com/QuentinRoy/lightmill-js/commit/92702456b537c88922d7a57f7b12aa09aaa83a97) - `log-server start` and `log-server export` no longer create the database. They exit with an error when the database is missing or has pending migrations, instead of running on an outdated schema. Back up the database, then run `log-server migrate` first.

- [#370](https://github.com/QuentinRoy/lightmill-js/pull/370) [`5bceea5`](https://github.com/QuentinRoy/lightmill-js/commit/5bceea54011e8e5d045f3be4e45e320b3f52b84d) - `DataStore` writes now go through `DataStore#withTransaction(fn)`, which runs `fn` in a serializable transaction: it commits when `fn` resolves and rolls back when it throws. Reads stay on the store. This lets a caller change several things at once, all or nothing. Custom `DataStore` implementations must provide `withTransaction`, make `close()` idempotent, and move `addExperiment`, `addRun`, `setRunStatus`, and `addLogs` onto the new `DataStoreTransaction` type. `addLogs` must return `created` with each log: `true` for a stored log, `false` for a duplicate the run already holds, returned with its stored id and not stored again. A `LOG_NUMBER_EXISTS_IN_SEQUENCE` error must carry the `logNumber` of the first log that conflicts. `resumeRun` is replaced by `cancelLogsAfter(runId, { after })`, which starts a new log sequence and does not change the run status: set it with `setRunStatus` in the same transaction. `addLogs` must treat a log that `cancelLogsAfter` kept as held: an identical one is a duplicate, a different one a `LOG_NUMBER_EXISTS_IN_SEQUENCE` conflict. `DataStoreTransaction` is exported. A transaction ends when its callback finishes, and later calls on it reject with the new `TRANSACTION_ENDED` code. The other new `DataStoreError` codes are `TRANSACTION_CONFLICT` (nothing was persisted, trying again may succeed), `TRANSACTION_COMMIT_FAILED`, `TRANSACTION_ROLLBACK_FAILED` (which also carries the error that caused the rollback as `originalError`), and `STORE_CLOSED`. `SQLiteDataStore#close()` now rejects new operations with `STORE_CLOSED` and waits for the ones in flight, and `SQLiteDataStore` can be closed with `await using`. The store no longer enforces the run lifecycle, the server does: `setRunStatus` and `addLogs` accept any run status, and the `DataStoreError` codes `RUN_HAS_ENDED` and `INVALID_LOG_NUMBER` are removed. A custom implementation only has to reject what its database states natively, like a foreign key or a duplicate name, and `setRunStatus` can now fail with `RUN_EXISTS` when a canceled run comes back after another run took its name. Code that calls `SQLiteDataStore` directly loses these rejections too: an illegal status change now succeeds. To migrate, wrap writes in `store.withTransaction((tx) => tx.addRun(...))`. Using `await using` requires TypeScript 5.2 or later.

- [#315](https://github.com/QuentinRoy/lightmill-js/pull/315) [`6200bd3`](https://github.com/QuentinRoy/lightmill-js/commit/6200bd3952d87a3976c28a3b94d2f588ab75104b) - Run resources replace `missingLogNumbers` with `firstMissingLogNumber`: the lowest missing log number in the run's current log sequence, or `null` when none is missing. Listing every missing log number could not scale to a log number far ahead of the others. Completing a run with missing logs now fails with error code `MISSING_LOGS` instead of `PENDING_LOGS`, and its detail names the missing log number. `Logger#flush()` reads `firstMissingLogNumber`, so `@lightmill/log-client` needs a server of the same version; its `FlushError` now names the missing log number and says how to recover. Read `firstMissingLogNumber` where you read `missingLogNumbers[0]`, and match `MISSING_LOGS` where you matched `PENDING_LOGS`.

- [#270](https://github.com/QuentinRoy/lightmill-js/pull/270) [`6651c93`](https://github.com/QuentinRoy/lightmill-js/commit/6651c93dadb2403ac084f61676df2a792f01891c) - Rename error codes to say what failed: `BODY_VALIDATION` is now `INVALID_REQUEST_BODY`, `HEADERS_VALIDATION` is `INVALID_REQUEST_HEADERS`, `QUERY_VALIDATION` is `INVALID_REQUEST_QUERY`, `INVALID_QUERY_PARAMETER` is `NOT_SUPPORTED_QUERY_PARAMETER`, and `INTERNAL_SERVER` is `INTERNAL_SERVER_ERROR`. `POST /sessions` answers `403 MISSING_CREDENTIALS` to a host session requested without an `Authorization` header. Update code that matches the old codes.

### Minor Changes

- [#442](https://github.com/QuentinRoy/lightmill-js/pull/442) [`52b72fa`](https://github.com/QuentinRoy/lightmill-js/commit/52b72fa3541c90a8935e49ea12e46652df5fce18) - `log-server start` takes `--allowed-origin <origin>` (repeatable) or the `ALLOWED_ORIGINS` environment variable (comma-separated) to name the pages on other origins that may call it, and answers those origins, and no others, with credentials allowed, so `@lightmill/log-client` can send its session cookie. It exits with an error unless `--allowed-origin` or `--same-site` is set. For development over HTTP, the two work together: `log-server start --same-site --allowed-origin http://localhost:5173 --host-password <password>`. `createLogServer` sets no CORS headers: put `cors({ origin: [...], credentials: true, exposedHeaders: ['Retry-After'] })` in front of it for pages on another origin.

- [#458](https://github.com/QuentinRoy/lightmill-js/pull/458) [`f9186e2`](https://github.com/QuentinRoy/lightmill-js/commit/f9186e21aa4ec9ab435e0f9f2b30e6905f8d0579) - `log-server start` takes `--secure-cookies <auto|always|never>`, the counterpart of the `secureCookies` option of `createLogServer`. With `--same-site`, it defaults to `auto`; use `always` to require HTTPS, or `never` to drop `Secure`. Behind a proxy that handles HTTPS, both `auto` and `always` need `--trust-proxy` and `X-Forwarded-Proto: https`; `always` does not set a cookie when the server cannot recognize HTTPS. Without `--same-site`, cookies stay `Secure`, and `auto` and `never` are rejected. A repeated `--secure-cookies` takes its last value.

- [#434](https://github.com/QuentinRoy/lightmill-js/pull/434) [`3e778a7`](https://github.com/QuentinRoy/lightmill-js/commit/3e778a70cfbd9a5191aaac813a54ae7b7e6c3b1d) - Add the `trustProxy` option of `createLogServer` and the `--trust-proxy` option of `log-server start`, off by default, to trust the `X-Forwarded-*` headers of a reverse proxy. A server behind a TLS-terminating proxy needs it to send `Secure` session cookies. Enable it only behind a proxy that sets these headers, since a client reaching the server directly could forge them. `log-server start --same-site` without `--trust-proxy` logs a warning that session cookies are `Secure` only for direct HTTPS.

- [#298](https://github.com/QuentinRoy/lightmill-js/pull/298) [`f54b83d`](https://github.com/QuentinRoy/lightmill-js/commit/f54b83d6d35d81890104584115084ab3f7d2f3fe) - Add `log-server experiment add` to create experiments in a SQLite database before participants start runs.

- [#326](https://github.com/QuentinRoy/lightmill-js/pull/326) [`468a0f9`](https://github.com/QuentinRoy/lightmill-js/commit/468a0f9a01f23d7680753c4244cf9a23f9e61c8c) - Every route accepts request bodies up to 1 MB, up from 100 kB. A larger body gets a `413 REQUEST_BODY_TOO_LARGE`, a body that is not valid JSON a `400 INVALID_REQUEST_BODY`, and a body with an encoding the server cannot decode a `415 UNSUPPORTED_MEDIA_TYPE`, all JSON:API errors instead of a `500`.

- [#324](https://github.com/QuentinRoy/lightmill-js/pull/324) [`f3d556d`](https://github.com/QuentinRoy/lightmill-js/commit/f3d556defdb58845ec79884446135cc6f577e596) - Requests may carry a `profile` parameter in their `Content-Type`, which is ignored, and the media type is matched regardless of case. Other parameters, such as `charset`, still get a `415`.

- [#293](https://github.com/QuentinRoy/lightmill-js/pull/293) [`cd263f5`](https://github.com/QuentinRoy/lightmill-js/commit/cd263f52a573a2de3ebd1e36830a5bb8dd6c5477) - Add a `--same-site` option to `log-server start`, so sessions work when the browser loads the page and calls the API from one site over HTTP, even from different ports: a page on `localhost:5173` can call an API on `localhost:3000`. Its cookies are `Secure` over HTTPS only. Behind a reverse proxy that terminates TLS, add `--trust-proxy` so the server sees HTTPS.

- [#323](https://github.com/QuentinRoy/lightmill-js/pull/323) [`7828de4`](https://github.com/QuentinRoy/lightmill-js/commit/7828de4b0102904b4936c99be3e64b6660007e6a) - `POST /logs` accepts a log already stored with the same number, type, and values, and answers `200` with the stored log's id instead of `409 LOG_NUMBER_EXISTS`. A new log still gets `201`, and a log with the same number but different content still gets a `409`.

- [#324](https://github.com/QuentinRoy/lightmill-js/pull/324) [`f3d556d`](https://github.com/QuentinRoy/lightmill-js/commit/f3d556defdb58845ec79884446135cc6f577e596) - `POST /operations` adds many logs of one run in a single request, all or nothing, and answers `200` with the id of each log, in order. Logs the run already holds with the same number, type, and values succeed like new ones. A number repeated within the request, or logs of several runs, get a `400`, and a number stored with different content gets a `409 LOG_NUMBER_EXISTS`, both pointing at the offending operation.

- [#348](https://github.com/QuentinRoy/lightmill-js/pull/348) [`9b3cc63`](https://github.com/QuentinRoy/lightmill-js/commit/9b3cc63078d5984019f5c817f05b0b4130edd1bd) - `SQLiteDataStore#getSessionStore()` returns an `express-session` store that persists sessions in the data store's database. Pass it to `createLogServer` as `sessionStore` so participants can resume runs after a restart. A session lives as long as its cookie (`sessionMaxAge`), or one day if the cookie has no expiry. Run `SQLiteDataStore.migrateDatabase(path)` first. Close the HTTP server before the data store: closing the data store ends its session store.

- [#294](https://github.com/QuentinRoy/lightmill-js/pull/294) [`d324658`](https://github.com/QuentinRoy/lightmill-js/commit/d3246586243b8fcdedfbf30cf8f17f219c8270a5) - Participants can now resume runs after restarting `log-server start`, as long as they return with the same browser session. Browser sessions last 30 days by default; use `--session-max-age-days` to change that. The new `sessionMaxAge` option of `createLogServer` sets the session cookie's lifetime in milliseconds.

### Patch Changes

- [#414](https://github.com/QuentinRoy/lightmill-js/pull/414) [`6e8d93d`](https://github.com/QuentinRoy/lightmill-js/commit/6e8d93d108d7e149f8a80802ad60ce9b84177d53) - Fix host authentication rejecting passwords containing a colon, and answering a malformed `Authorization` header with a `500` instead of a `403`.

- [#417](https://github.com/QuentinRoy/lightmill-js/pull/417) [`58853f8`](https://github.com/QuentinRoy/lightmill-js/commit/58853f82364fe8b819143e96cc5183681e94e1d5) - Fix a request body sent without a `Content-Type` header being ignored, or rejected as missing. It now answers `415 UNSUPPORTED_MEDIA_TYPE`.

- [#409](https://github.com/QuentinRoy/lightmill-js/pull/409) [`600ec4c`](https://github.com/QuentinRoy/lightmill-js/commit/600ec4cefcdf6096623566a2eb7124c5c0ab3b49) - Fix `GET /sessions/{id}` ignoring the `include` query parameter, and `GET /logs` and `GET /logs/{id}` returning compound documents that break JSON:API. A nested `include` such as `run.experiment` now also returns the resources on its path (the runs), and a last log that is already in `data` is no longer repeated in `included`.

- [#400](https://github.com/QuentinRoy/lightmill-js/pull/400) [`e839348`](https://github.com/QuentinRoy/lightmill-js/commit/e839348fd81a455618cc03d914d6ff67ba571d68) - Fix the CSV export of `GET /logs` writing values that contain a carriage return without quotes, which CSV readers can take for the end of a row. Such values are now quoted.

- [#466](https://github.com/QuentinRoy/lightmill-js/pull/466) [`a673e51`](https://github.com/QuentinRoy/lightmill-js/commit/a673e51caea55748568ea0f2f0d4a1f30bde2a7c) - Fix `log-server export --output` crashing when the standard output is not a terminal, in a script or CI for example, and reporting one log too many. The progress counter now shows only in a terminal, and the header row is no longer counted as an exported log.

- [#469](https://github.com/QuentinRoy/lightmill-js/pull/469) [`7412ff4`](https://github.com/QuentinRoy/lightmill-js/commit/7412ff4a8c7555baa9e7bb37c6bec1f210f4dab1) - Fix `log-server export` crashing with an uncaught exception when reading the database fails midway. The error is now reported, and `--output` no longer leaves a truncated file: the export is written to a temporary file and moved into place only once complete.

- [#415](https://github.com/QuentinRoy/lightmill-js/pull/415) [`ee9238d`](https://github.com/QuentinRoy/lightmill-js/commit/ee9238d9bc176d6a11454924ee6a100c1b8effd0) - Fix the log export of `GET /logs`, `log-server export`, and `SQLiteDataStore#getLogs` skipping or interleaving logs. When a page of results ended inside a run without a name, the rest of that run and the experiment's later runs were missing, and the logs of runs that share a name, such as canceled runs, were interleaved and some skipped. The logs of each run now come together, and runs that share a name come in the order they were created.

- [#418](https://github.com/QuentinRoy/lightmill-js/pull/418) [`323cff8`](https://github.com/QuentinRoy/lightmill-js/commit/323cff8cc7bfccc4496ce7591a69993b3c4fcdbc) - Fix requests with malformed percent-encoding answering `500 INTERNAL_SERVER_ERROR`. A malformed query parameter, such as `GET /experiments?filter[name]=%E0%A4%A`, now answers `400 INVALID_REQUEST_QUERY`, and a malformed path parameter, such as `GET /sessions/%E0%A4%A`, answers `404 NOT_FOUND`.

- [#418](https://github.com/QuentinRoy/lightmill-js/pull/418) [`323cff8`](https://github.com/QuentinRoy/lightmill-js/commit/323cff8cc7bfccc4496ce7591a69993b3c4fcdbc) - Fix query parameters being decoded twice, which misread values containing an encoded `&`, `=`, `+`, or `%`: `filter[name]=a%26b` read as `filter[name]=a` and a stray `b` parameter, so filtering on such an experiment name found nothing.

- [#409](https://github.com/QuentinRoy/lightmill-js/pull/409) [`600ec4c`](https://github.com/QuentinRoy/lightmill-js/commit/600ec4cefcdf6096623566a2eb7124c5c0ab3b49) - Fix `GET /logs` crashing the server, or leaving the request hanging, when reading the logs failed after the response had started. The request is now aborted and the server keeps running.

- [#290](https://github.com/QuentinRoy/lightmill-js/pull/290) [`7bb7c48`](https://github.com/QuentinRoy/lightmill-js/commit/7bb7c48d6a455d3c907b81f7c806b96a8909014f) - Fix installing on Node 26, which failed while compiling better-sqlite3 11 from source. The server now uses better-sqlite3 13, which ships prebuilt binaries for current Node versions.

- [#374](https://github.com/QuentinRoy/lightmill-js/pull/374) [`8c93c4d`](https://github.com/QuentinRoy/lightmill-js/commit/8c93c4d00b90160c911f19b7e7ac388f53d6af33) - A request that fails because the database is busy, for example locked by the `log-server` CLI, answers `503 SERVICE_UNAVAILABLE` with `Retry-After: 1` instead of a `500`. Nothing was saved, so the request can be sent again.

- [#285](https://github.com/QuentinRoy/lightmill-js/pull/285) [`754ab7a`](https://github.com/QuentinRoy/lightmill-js/commit/754ab7a99fa4e7502705f1796668b138ec78f683) - Fix the `log-server` command, which failed at startup. It now runs its commands, and accepts a `PORT` environment variable.

- [#314](https://github.com/QuentinRoy/lightmill-js/pull/314) [`299fd2b`](https://github.com/QuentinRoy/lightmill-js/commit/299fd2b08895c944e0ec6524f5e07bc7c540c798) - Fix a log being lost when it arrived before logs with lower numbers. For example, sending logs 11 and 33, then 22 and 44, used to erase log 33. Logs already erased this way cannot be recovered.

- [#291](https://github.com/QuentinRoy/lightmill-js/pull/291) [`ad7294d`](https://github.com/QuentinRoy/lightmill-js/commit/ad7294d552d7e3754374a6241e930dbb9bfafed5) - Make `@lightmill/log-api` a regular dependency instead of a peer dependency. You no longer need to install it next to `@lightmill/log-server`.

- [#375](https://github.com/QuentinRoy/lightmill-js/pull/375) [`2c96c24`](https://github.com/QuentinRoy/lightmill-js/commit/2c96c24d0c2a8749ff94a6a9854c15dc2a80cdeb) - `PATCH /runs/{id}` no longer answers `403 ONGOING_RUNS` because the session has another ongoing run.

- [#380](https://github.com/QuentinRoy/lightmill-js/pull/380) [`eb88ae2`](https://github.com/QuentinRoy/lightmill-js/commit/eb88ae294c6221fe2acaa73468ef3c14e24b629c) - Fix `POST /logs` answering `500` to a resend of a log that a resume kept, for example after a lost response. It now answers `200` with the stored log's id, or `409 LOG_NUMBER_EXISTS` if the type or values differ.

- [#375](https://github.com/QuentinRoy/lightmill-js/pull/375) [`2c96c24`](https://github.com/QuentinRoy/lightmill-js/commit/2c96c24d0c2a8749ff94a6a9854c15dc2a80cdeb) - `POST /runs` and `DELETE /sessions/current` handle one request at a time for each session, so two simultaneous creations can no longer both succeed. When the server cannot save the session during one of them, the request now answers `500` instead of success.

- [#364](https://github.com/QuentinRoy/lightmill-js/pull/364) [`3ef31af`](https://github.com/QuentinRoy/lightmill-js/commit/3ef31aff9da09ad1159486e22291300322d5791c) - Fix `POST /runs` answering `500` for an experiment that does not exist. It now answers `403 EXPERIMENT_NOT_FOUND`.
- Updated dependencies [[`6651c93`](https://github.com/QuentinRoy/lightmill-js/commit/6651c93dadb2403ac084f61676df2a792f01891c), [`6651c93`](https://github.com/QuentinRoy/lightmill-js/commit/6651c93dadb2403ac084f61676df2a792f01891c), [`468a0f9`](https://github.com/QuentinRoy/lightmill-js/commit/468a0f9a01f23d7680753c4244cf9a23f9e61c8c), [`bbcb236`](https://github.com/QuentinRoy/lightmill-js/commit/bbcb236a538f3b185bde94da31c95fcd78b49d1e), [`7828de4`](https://github.com/QuentinRoy/lightmill-js/commit/7828de4b0102904b4936c99be3e64b6660007e6a), [`f3d556d`](https://github.com/QuentinRoy/lightmill-js/commit/f3d556defdb58845ec79884446135cc6f577e596), [`1968561`](https://github.com/QuentinRoy/lightmill-js/commit/1968561109828d73952f465409053ab00cdaf3f9), [`8c93c4d`](https://github.com/QuentinRoy/lightmill-js/commit/8c93c4d00b90160c911f19b7e7ac388f53d6af33), [`bbcb236`](https://github.com/QuentinRoy/lightmill-js/commit/bbcb236a538f3b185bde94da31c95fcd78b49d1e), [`6abfe1b`](https://github.com/QuentinRoy/lightmill-js/commit/6abfe1b27e852b8af7b284816140c5b6ab77082b), [`6200bd3`](https://github.com/QuentinRoy/lightmill-js/commit/6200bd3952d87a3976c28a3b94d2f588ab75104b), [`6651c93`](https://github.com/QuentinRoy/lightmill-js/commit/6651c93dadb2403ac084f61676df2a792f01891c)]:
  - @lightmill/log-api@5.0.0

## 5.0.0-beta.4

### Major Changes

- [#396](https://github.com/QuentinRoy/lightmill-js/pull/396) [`bbcb236`](https://github.com/QuentinRoy/lightmill-js/commit/bbcb236a538f3b185bde94da31c95fcd78b49d1e) - `PATCH /runs/{id}` refuses a `lastLogNumber` sent with a status other than `running` as an invalid request body: `400 INVALID_REQUEST_BODY`, with a `source.pointer` to `/data/attributes/lastLogNumber`. It used to answer `403 INVALID_LAST_LOG_NUMBER`. The schema now describes `lastLogNumber`: it resumes the run, so it requires the status `running`, or no status on a running run. A `lastLogNumber` without a status on a run that is not running still answers `403 INVALID_LAST_LOG_NUMBER`. Update clients that handle `403 INVALID_LAST_LOG_NUMBER` for the first case.

- [#395](https://github.com/QuentinRoy/lightmill-js/pull/395) [`5cf9dc3`](https://github.com/QuentinRoy/lightmill-js/commit/5cf9dc364e0420f584dfb5d0daae3264b4ae7827) - `LogServer` no longer takes a `mode` option. It only turned off response validation when set to `test` (the default came from `NODE_ENV`), which let tests pass on responses that failed in production. Responses are now validated in every mode. Remove `mode` from your `LogServer` options.

- [#396](https://github.com/QuentinRoy/lightmill-js/pull/396) [`bbcb236`](https://github.com/QuentinRoy/lightmill-js/commit/bbcb236a538f3b185bde94da31c95fcd78b49d1e) - Only the session that created a run can add logs to it or change it, so two clients can no longer write to the same run. A host session used to write to any run: `POST /logs`, `POST /operations` and `PATCH /runs/{id}` now answer `403 RUN_NOT_OWNED` when it writes to a run another session created. A host can still read every run, and cancel any run with `PATCH /runs/{id}`. Write to a run from the session that created it.

### Patch Changes

- [#395](https://github.com/QuentinRoy/lightmill-js/pull/395) [`5cf9dc3`](https://github.com/QuentinRoy/lightmill-js/commit/5cf9dc364e0420f584dfb5d0daae3264b4ae7827) - Fix `POST /operations` answering `500` after storing the logs it accepted. It now answers `200` with their ids.
- Updated dependencies [[`bbcb236`](https://github.com/QuentinRoy/lightmill-js/commit/bbcb236a538f3b185bde94da31c95fcd78b49d1e), [`1968561`](https://github.com/QuentinRoy/lightmill-js/commit/1968561109828d73952f465409053ab00cdaf3f9), [`bbcb236`](https://github.com/QuentinRoy/lightmill-js/commit/bbcb236a538f3b185bde94da31c95fcd78b49d1e), [`6abfe1b`](https://github.com/QuentinRoy/lightmill-js/commit/6abfe1b27e852b8af7b284816140c5b6ab77082b)]:
  - @lightmill/log-api@5.0.0-beta.4

## 5.0.0-beta.3

### Major Changes

- [#375](https://github.com/QuentinRoy/lightmill-js/pull/375) [`2c96c24`](https://github.com/QuentinRoy/lightmill-js/commit/2c96c24d0c2a8749ff94a6a9854c15dc2a80cdeb) - `POST /runs` let a session create a run while it held an `idle` run. It now answers `403 ONGOING_RUNS`, as it does for a `running` or `interrupted` run, since an idle run has not ended. Start or cancel the idle run before creating another.

- [#374](https://github.com/QuentinRoy/lightmill-js/pull/374) [`8c93c4d`](https://github.com/QuentinRoy/lightmill-js/commit/8c93c4d00b90160c911f19b7e7ac388f53d6af33) - Some requests the server used to accept now fail. `POST /runs` only creates `idle` or `running` runs, and answers `403 INVALID_RUN_STATUS` for any other status. `PATCH /runs/{id}` answers `403 INVALID_LAST_LOG_NUMBER` when `lastLogNumber` comes with a status other than `running`, or without a status on a run that is not running: it used to resume the run if `lastLogNumber` was the run's last log number, even with the status `completed`. A `name` or an `experiment` relationship that differs from the run's answers `403 IMMUTABLE_RUN_ATTRIBUTE`, with a `source.pointer` to the offending attribute, instead of being ignored. Completing an already completed run succeeds even if a log number is missing. Logs are stored only if the run is running when they are written: a run that ended since the request arrived stores none, and `POST /logs` and `POST /operations` answer `403 INVALID_RUN_STATUS` where they could fail with a `500`.
  
  The server, not the database, now enforces these rules, in the same transaction as the writes they guard, so a custom `DataStore` does not have to implement them. Update clients that create completed runs, send a `lastLogNumber` without resuming, or send a different `name` or `experiment` in a `PATCH`.
  
  Upgrading applies a database migration that removes the triggers enforcing the lifecycle and makes run names unique among runs that are not canceled: back up the database, then run `log-server migrate`. It cannot be undone. To go back, restore the backup. It stops, and lists the runs, if two runs of an experiment that are not canceled share a name: fix them by hand, then migrate again.

- [#375](https://github.com/QuentinRoy/lightmill-js/pull/375) [`2c96c24`](https://github.com/QuentinRoy/lightmill-js/commit/2c96c24d0c2a8749ff94a6a9854c15dc2a80cdeb) - A custom session store must return what it just saved when the same process reads it back: once `set` calls back, `get` returns that data. `POST /runs` and `DELETE /sessions/current` now read the session again after waiting for their turn, and use what the store returns. A store that reads from a copy of the data that can lag behind, or reports a write as done before it can be read, would give them an old session. The memory store and `SQLiteDataStore#getSessionStore()` are fine. If your store cannot promise this, use one of those instead.

- [#370](https://github.com/QuentinRoy/lightmill-js/pull/370) [`5bceea5`](https://github.com/QuentinRoy/lightmill-js/commit/5bceea54011e8e5d045f3be4e45e320b3f52b84d) - `DataStore` writes now go through `DataStore#withTransaction(fn)`, which runs `fn` in a serializable transaction: it commits when `fn` resolves and rolls back when it throws. Reads stay on the store. This lets a caller change several things at once, all or nothing. Custom `DataStore` implementations must provide `withTransaction`, make `close()` idempotent, and move `addExperiment`, `addRun`, `setRunStatus`, and `addLogs` onto the new `DataStoreTransaction` type. `resumeRun` is replaced by `cancelLogsAfter(runId, { after })`, which starts a new log sequence and does not change the run status: set it with `setRunStatus` in the same transaction. `addLogs` must treat a log that `cancelLogsAfter` kept as held: an identical one is a duplicate, a different one a `LOG_NUMBER_EXISTS_IN_SEQUENCE` conflict. `DataStoreTransaction` is exported. A transaction ends when its callback finishes, and later calls on it reject with the new `TRANSACTION_ENDED` code. The other new `DataStoreError` codes are `TRANSACTION_CONFLICT` (nothing was persisted, trying again may succeed), `TRANSACTION_COMMIT_FAILED`, `TRANSACTION_ROLLBACK_FAILED` (which also carries the error that caused the rollback as `originalError`), and `STORE_CLOSED`. `SQLiteDataStore#close()` now rejects new operations with `STORE_CLOSED` and waits for the ones in flight, and `SQLiteDataStore` can be closed with `await using`. The store no longer enforces the run lifecycle, the server does: `setRunStatus` and `addLogs` accept any run status, and the `DataStoreError` codes `RUN_HAS_ENDED` and `INVALID_LOG_NUMBER` are removed. A custom implementation only has to reject what its database states natively, like a foreign key or a duplicate name, and `setRunStatus` can now fail with `RUN_EXISTS` when a canceled run comes back after another run took its name. Code that calls `SQLiteDataStore` directly loses these rejections too: an illegal status change now succeeds. To migrate, wrap writes in `store.withTransaction((tx) => tx.addRun(...))`. Using `await using` requires TypeScript 5.2 or later; on Node 22, compile with a target below `esnext`.

### Patch Changes

- [#374](https://github.com/QuentinRoy/lightmill-js/pull/374) [`8c93c4d`](https://github.com/QuentinRoy/lightmill-js/commit/8c93c4d00b90160c911f19b7e7ac388f53d6af33) - A request that fails because the database is busy, for example locked by the `log-server` CLI, answers `503 SERVICE_UNAVAILABLE` with `Retry-After: 1` instead of a `500`. Nothing was saved, so the request can be sent again.

- [#375](https://github.com/QuentinRoy/lightmill-js/pull/375) [`2c96c24`](https://github.com/QuentinRoy/lightmill-js/commit/2c96c24d0c2a8749ff94a6a9854c15dc2a80cdeb) - `PATCH /runs/{id}` no longer answers `403 ONGOING_RUNS` because the session has another ongoing run.

- [#380](https://github.com/QuentinRoy/lightmill-js/pull/380) [`eb88ae2`](https://github.com/QuentinRoy/lightmill-js/commit/eb88ae294c6221fe2acaa73468ef3c14e24b629c) - Fix `POST /logs` and `POST /operations` answering `500` to a resend of a log that a resume kept, which clients retried until they paused. Such a resend is now a duplicate log: `POST /logs` answers `200` with the stored log's id. A log with that number but a different type or values answers `409 LOG_NUMBER_EXISTS`.

- [#375](https://github.com/QuentinRoy/lightmill-js/pull/375) [`2c96c24`](https://github.com/QuentinRoy/lightmill-js/commit/2c96c24d0c2a8749ff94a6a9854c15dc2a80cdeb) - `POST /runs` and `DELETE /sessions/current` handle one request at a time for each session, so two simultaneous creations can no longer both succeed. When the server cannot save the session during one of them, the request now answers `500` instead of success.

- [#377](https://github.com/QuentinRoy/lightmill-js/pull/377) [`b072137`](https://github.com/QuentinRoy/lightmill-js/commit/b0721372952d28bcfdebf0828b260d499239d767) - Fix `log-server export --logType` ignoring the requested log type.
- Updated dependencies [[`8c93c4d`](https://github.com/QuentinRoy/lightmill-js/commit/8c93c4d00b90160c911f19b7e7ac388f53d6af33)]:
  - @lightmill/log-api@5.0.0-beta.3

## 5.0.0-beta.2

### Major Changes

- [#323](https://github.com/QuentinRoy/lightmill-js/pull/323) [`7828de4`](https://github.com/QuentinRoy/lightmill-js/commit/7828de4b0102904b4936c99be3e64b6660007e6a) - Custom `DataStore` implementations must return `created` with each log from `addLogs`: `true` for a stored log, `false` for a duplicate log already held by the run, which must be returned with its stored id and not stored again. A `DataStoreError` with `LOG_NUMBER_EXISTS_IN_SEQUENCE` must now carry the `logNumber` of the first log that conflicts.

- [#349](https://github.com/QuentinRoy/lightmill-js/pull/349) [`65c9401`](https://github.com/QuentinRoy/lightmill-js/commit/65c94018aa44e3269d7d4cd715c51ebc62bbc17e) - `new SQLiteDataStore(path)` can no longer be called: use `await SQLiteDataStore.open(path, options)`. It throws a `DataStoreError` with code `SCHEMA_OUTDATED` when the database has pending migrations, instead of failing on the first query that needs them, and throws when the file does not exist instead of creating it. To create or migrate a database, run `await SQLiteDataStore.migrateDatabase(path)` first. As an exception, an in-memory database (`':memory:'`) is migrated automatically. The `migrateDatabase()` instance method is removed from `SQLiteDataStore` and from the `DataStore` interface: custom implementations no longer need it. `DataStoreError` is now exported, so embedders can catch it.

- [#345](https://github.com/QuentinRoy/lightmill-js/pull/345) [`9270245`](https://github.com/QuentinRoy/lightmill-js/commit/92702456b537c88922d7a57f7b12aa09aaa83a97) - `log-server start` and `log-server export` no longer create the database. They exit with an error when the database is missing or has pending migrations, instead of running on an outdated schema. Back up the database, then run `log-server migrate` first.

### Minor Changes

- [#326](https://github.com/QuentinRoy/lightmill-js/pull/326) [`468a0f9`](https://github.com/QuentinRoy/lightmill-js/commit/468a0f9a01f23d7680753c4244cf9a23f9e61c8c) - Every route accepts request bodies up to 1 MB, up from 100 kB. A larger body gets a `413 REQUEST_BODY_TOO_LARGE`, a body that is not valid JSON a `400 INVALID_REQUEST_BODY`, and a body with an encoding the server cannot decode a `415 UNSUPPORTED_MEDIA_TYPE`, all JSON:API errors instead of a `500`.

- [#324](https://github.com/QuentinRoy/lightmill-js/pull/324) [`f3d556d`](https://github.com/QuentinRoy/lightmill-js/commit/f3d556defdb58845ec79884446135cc6f577e596) - Requests may carry a `profile` parameter in their `Content-Type`, which is ignored, and the media type is matched regardless of case. Other parameters, such as `charset`, still get a `415`.

- [#323](https://github.com/QuentinRoy/lightmill-js/pull/323) [`7828de4`](https://github.com/QuentinRoy/lightmill-js/commit/7828de4b0102904b4936c99be3e64b6660007e6a) - `POST /logs` accepts a log already stored with the same number, type, and values, and answers `200` with the stored log's id instead of `409 LOG_NUMBER_EXISTS`. A new log still gets `201`, and a log with the same number but different content still gets a `409`.

- [#324](https://github.com/QuentinRoy/lightmill-js/pull/324) [`f3d556d`](https://github.com/QuentinRoy/lightmill-js/commit/f3d556defdb58845ec79884446135cc6f577e596) - `POST /operations` adds many logs of one run in a single request, all or nothing, and answers `200` with the id of each log, in order. Logs the run already holds with the same number, type, and values succeed like new ones. A number repeated within the request, or logs of several runs, get a `400`, and a number stored with different content gets a `409 LOG_NUMBER_EXISTS`, both pointing at the offending operation.

- [#348](https://github.com/QuentinRoy/lightmill-js/pull/348) [`9b3cc63`](https://github.com/QuentinRoy/lightmill-js/commit/9b3cc63078d5984019f5c817f05b0b4130edd1bd) - `SQLiteDataStore#getSessionStore()` returns an `express-session` store that persists sessions in the data store's database. Pass it to `LogServer` as `sessionStore` so participants can resume runs after a restart. A session lives as long as its cookie (`sessionMaxAge`), or one day if the cookie has no expiry. Run `SQLiteDataStore.migrateDatabase(path)` first. Close the HTTP server before the data store: closing the data store ends its session store.

### Patch Changes

- [#350](https://github.com/QuentinRoy/lightmill-js/pull/350) [`0ee63e6`](https://github.com/QuentinRoy/lightmill-js/commit/0ee63e6b688d7ee2bfad0a8cd31081771405190d) - `log-server start --port 0` logs the port the operating system picked, instead of `0`.

- [#364](https://github.com/QuentinRoy/lightmill-js/pull/364) [`3ef31af`](https://github.com/QuentinRoy/lightmill-js/commit/3ef31aff9da09ad1159486e22291300322d5791c) - `POST /runs` returns `403 EXPERIMENT_NOT_FOUND` when the requested experiment does not exist.
- Updated dependencies [[`468a0f9`](https://github.com/QuentinRoy/lightmill-js/commit/468a0f9a01f23d7680753c4244cf9a23f9e61c8c), [`7828de4`](https://github.com/QuentinRoy/lightmill-js/commit/7828de4b0102904b4936c99be3e64b6660007e6a), [`f3d556d`](https://github.com/QuentinRoy/lightmill-js/commit/f3d556defdb58845ec79884446135cc6f577e596)]:
  - @lightmill/log-api@5.0.0-beta.2

## 5.0.0-beta.1

### Major Changes

- [#314](https://github.com/QuentinRoy/lightmill-js/pull/314) [`299fd2b`](https://github.com/QuentinRoy/lightmill-js/commit/299fd2b08895c944e0ec6524f5e07bc7c540c798) - A log number far ahead of a run's other logs no longer crashes the server. `DataStore#getMissingLogs` is removed, since listing every missing log number is what made such logs crash it: read `firstMissingLogNumber` and `lastLogNumber` from `DataStore#getRuns` records instead, and provide them in custom `DataStore` implementations.

- [#315](https://github.com/QuentinRoy/lightmill-js/pull/315) [`6200bd3`](https://github.com/QuentinRoy/lightmill-js/commit/6200bd3952d87a3976c28a3b94d2f588ab75104b) - Run resources replace `missingLogNumbers` with `firstMissingLogNumber`: the lowest missing log number in the run's current log sequence, or `null` when none is missing. Listing every missing log number could not scale to a log number far ahead of the others. Completing a run with missing logs now fails with error code `MISSING_LOGS` instead of `PENDING_LOGS`, and its detail names the missing log number. `Logger#flush()` reads `firstMissingLogNumber`, so `@lightmill/log-client` needs a server of the same version; its `FlushError` now names the missing log number and says how to recover. Read `firstMissingLogNumber` where you read `missingLogNumbers[0]`, and match `MISSING_LOGS` where you matched `PENDING_LOGS`.

### Patch Changes

- [#314](https://github.com/QuentinRoy/lightmill-js/pull/314) [`299fd2b`](https://github.com/QuentinRoy/lightmill-js/commit/299fd2b08895c944e0ec6524f5e07bc7c540c798) - Fix a log being lost when it arrived before logs with lower numbers. For example, sending logs 11 and 33, then 22 and 44, used to erase log 33. Logs already erased this way cannot be recovered.
- Updated dependencies [[`6200bd3`](https://github.com/QuentinRoy/lightmill-js/commit/6200bd3952d87a3976c28a3b94d2f588ab75104b)]:
  - @lightmill/log-api@5.0.0-beta.1

## 5.0.0-beta.0

### Major Changes

- [#270](https://github.com/QuentinRoy/lightmill-js/pull/270) [`72effc7`](https://github.com/QuentinRoy/lightmill-js/commit/72effc7f42038179e7120ba0ab0beb7691a46b8a) - Change some validation error codes to match new log-api. Please refer to @lightmill/log-api openapi.yaml for the new validation error codes.

- [#290](https://github.com/QuentinRoy/lightmill-js/pull/290) [`7bb7c48`](https://github.com/QuentinRoy/lightmill-js/commit/7bb7c48d6a455d3c907b81f7c806b96a8909014f) - Switch to better-sqlite3 13, which ships prebuilt binaries for current Node versions, including Node 26. Installing on Node 26 used to fail while compiling better-sqlite3 11 from source.

- [#290](https://github.com/QuentinRoy/lightmill-js/pull/290) [`273096e`](https://github.com/QuentinRoy/lightmill-js/commit/273096edb0b11133ac6470d20c4c8fe0e0e33d0b) - Require Node 22.18 or later on Node 22, or Node 24.3 or later. Node 22.0 to 22.17, Node 23, and Node 24.0 to 24.2 are no longer supported.

### Minor Changes

- [#298](https://github.com/QuentinRoy/lightmill-js/pull/298) [`f54b83d`](https://github.com/QuentinRoy/lightmill-js/commit/f54b83d6d35d81890104584115084ab3f7d2f3fe) - Add `log-server experiment add` to create experiments in a SQLite database before participants start runs.

- [#293](https://github.com/QuentinRoy/lightmill-js/pull/293) [`cd263f5`](https://github.com/QuentinRoy/lightmill-js/commit/cd263f52a573a2de3ebd1e36830a5bb8dd6c5477) - Add a `--same-origin` option to the `log-server start` command so sessions
  work when the browser loads the page and calls the API from one HTTP origin.
  Rule out cookie settings that browsers reject, and document when HTTPS is
  required.

- [#294](https://github.com/QuentinRoy/lightmill-js/pull/294) [`d324658`](https://github.com/QuentinRoy/lightmill-js/commit/d3246586243b8fcdedfbf30cf8f17f219c8270a5) - Participants can now resume runs after restarting `log-server start`, as long
  as they return with the same browser session. Browser sessions can last up to
  30 days by default; use `--session-max-age-days` to change that period.

### Patch Changes

- [#285](https://github.com/QuentinRoy/lightmill-js/pull/285) [`754ab7a`](https://github.com/QuentinRoy/lightmill-js/commit/754ab7a99fa4e7502705f1796668b138ec78f683) - Fix the `log-server` command, which failed at startup. It now runs its commands, and accepts a `PORT` environment variable.

- [#291](https://github.com/QuentinRoy/lightmill-js/pull/291) [`ad7294d`](https://github.com/QuentinRoy/lightmill-js/commit/ad7294d552d7e3754374a6241e930dbb9bfafed5) - Make `@lightmill/log-api` a regular dependency instead of a peer dependency. You no longer need to install it next to `@lightmill/log-server`.
- Updated dependencies [[`6651c93`](https://github.com/QuentinRoy/lightmill-js/commit/6651c93dadb2403ac084f61676df2a792f01891c), [`6651c93`](https://github.com/QuentinRoy/lightmill-js/commit/6651c93dadb2403ac084f61676df2a792f01891c), [`6651c93`](https://github.com/QuentinRoy/lightmill-js/commit/6651c93dadb2403ac084f61676df2a792f01891c), [`6651c93`](https://github.com/QuentinRoy/lightmill-js/commit/6651c93dadb2403ac084f61676df2a792f01891c)]:
  - @lightmill/log-api@5.0.0-beta.0

## 4.1.0

### Minor Changes

- 6190db8: Updated `DataStore#getMissingLogs` so its filter argument is now optional, allowing calls without any parameters to get all missing logs.

### Patch Changes

- 95d944f: Fix DataStore#getMissingLogs returning canceled logs.

## 4.0.1

### Patch Changes

- 0c369fc: Fixed handling of the `q=` weighting factor in the `Accept` header for `GET /logs`. Previously, it was not supported and could cause requests to fail. The server now correctly interprets `q=` values and returns the preferred media type accordingly.
- 0c369fc: The `GET /logs` endpoint no longer fails when the `Accept` header is unrecognized. It now defaults to returning CSV format in such cases.
- Updated dependencies [0c369fc]
  - @lightmill/log-api@4.0.1

## 4.0.0

### Major Changes

- 4cdd8e6: Parameters passed to `addRun` may now explicitly specify `runName: null` to indicate that the run has no name. Omitting the `runName` parameter is still allowed—it will default to `null` if not provided. However, the promises returned by `addRun` and `getRuns` must now always include `runName: null` for unnamed runs, rather than using `undefined` or omitting the field. This improves consistency with the JSON API, where unnamed runs are represented with `name: null`.
- 369b404: Renamed `SqliteStore` to `SqliteDataStore` to avoid confusion with other store types (e.g., session store) used in the system. This is a breaking change: consumers must update their imports to use `SqliteDataStore` instead of `SqliteStore`.
- 0cd6985: The `store` option in `LogServer` has been renamed to `dataStore` to reduce confusion with the `sessionStore` option. To update, replace any usage of `store` in the `LogServer` config with `dataStore`.
- 000d116: Update server to comply with new API contract. Post and put requests are now required to use `application/vnd.api+json` as content type. Responses' content type is now `application/vnd.api+json` (except when responding with CSV content).
- 97f7410: `Store.migrateDatabase` now throws on error instead of resolving with a result. On success, it resolves with `void`. Previously, it returned Kysely’s migration result and did not throw on failure, which made it harder to implement alternative solutions without relying on Kysely.
- e7f2da4: `GET /logs` handler now defaults to CSV format and only returns JSON when the Accept header is set to JSON. This change allows logs to be downloadable from HTML without requiring JavaScript to set the `Accept` header.

### Minor Changes

- 9d4c3b1: Run resources now include the list of missing log numbers for the run.

### Patch Changes

- 004aecf: Fix log query filter. Filtering by `experimentName` or `runName` is now propertly supported.
- 4cdd8e6: Fix SqliteDataStore not throwing the proper DataStoreError when trying to create a run for an unknown experiment.
- Updated dependencies [36607bc]
- Updated dependencies [9d4c3b1]
- Updated dependencies [4cdd8e6]
  - @lightmill/log-api@4.0.0

## 3.2.0

### Minor Changes

- 24579e5: Stop hiding error messages from client

## 3.1.2

### Patch Changes

- 3900ae4: Fix cancelation of completed runs. Requires database migration.

## 3.1.1

### Patch Changes

- e8d8347: Fix broken requests with query strings

## 3.1.0

### Minor Changes

- 93ae6d1: Allow canceling completed runs

## 3.0.2

### Patch Changes

- 082a7b9: Remove useless dependencies

## 3.0.1

### Patch Changes

- 388f471: Add shebang to log-server's cli

## 3.0.0

### Major Changes

New log server implementing @lightmill/log-api's contract.

## 3.0.0-beta.34

### Patch Changes

- Updated dependencies [0f22dda]
  - @lightmill/log-api@3.0.0-beta.34

## 3.0.0-beta.33

### Major Changes

- 41c5314: Update to new API.

### Patch Changes

- Updated dependencies [07e75b4]
  - @lightmill/log-api@3.0.0-beta.33

## 3.0.0-beta.32

### Minor Changes

- 09e128a: Significantly increase default select query limit of SQLiteStore
- 289f5f6: Display count of exported logs during export when output is a file.

## 3.0.0-beta.31

### Minor Changes

- 634945b: Add a select query result limit for SQliteStore to prevent too many logs to be loaded in memory at the same time. Once the limit is attained logs are yielded and the next logs are loaded once their done being processed.

## 3.0.0-beta.26

### Patch Changes

- ea9d60a: Do not crash when client attempts to post a log whose number already exists in the ongoing sequence.

## 3.0.0-beta.25

### Patch Changes

- Updated dependencies [2d3d87e]
  - @lightmill/log-api@3.0.0-beta.25

## 3.0.0-beta.24

### Patch Changes

- cd62201: Fix extra column "number" being exported

## 3.0.0-beta.23

### Major Changes

- 5b3eecd: Update log api : date isn't required anymore to save a log, but number is. Number is used to order logs, but also detect missing logs which date was not able to do.
- aed9788: Clients now keep access to a run after having canceled or completed it. One must delete the session to remove a client's access to a run.
- 5d9d8f3: createLogServer factory has been renamed to LogServer
- 5b3eecd: Change the database schema with no provided migration. Consequently this is incompatible with old database file. This is to account for the new log api, and eventually run resuming. DO NOT UPGRADE IF YOU HAVE LOGS IN YOUR DATABASE.
- 9021cd4: Stop exporting api types. Use export from @lightmill/log-api instead if needed.
- b426249: Change log api HTTP method to update run status: switch to patch instead of put.
- 956791f: Flatten urls to prevent collisions: post /experiments/runs -> post /runs, get /experiments/:experiment/runs/logs -> get /experiments/:experiment/logs.

### Minor Changes

- aed9788: Add endpoint to get run info
- aed9788: Add the ability to resume a running or canceled run.

### Patch Changes

- aed9788: Prevent resuming a run when there is already another run running
- aed9788: Fix run start being blocked when there run in the session but they're all completed
- Updated dependencies [5b3eecd]
- Updated dependencies [aed9788]
- Updated dependencies [aed9788]
- Updated dependencies [b426249]
- Updated dependencies [9021cd4]
  - @lightmill/log-api@3.0.0-beta.23

## 3.0.0-beta.22

### Major Changes

- 4ba84e4: Rename Store#addRunLogs to Store#addLogs.
- 4ba84e4: Stop sorting logs per type with SQLiteStore#getLogs. Creation date is more relevant. Also update the corresponding database index.
- 97ea257: Store has been renamed to SQLiteStore. The store type has been untied from the SQLiteStore class.
- 4ba84e4: Store#addLogs now requires a createdAt property for each log

### Patch Changes

- 97ea257: fix clients being able to create two runs

## 3.0.0-beta.19

### Patch Changes

- e3c47af: fix crashes when trying to create a run that already exists

## 3.0.0-alpha.18

### Major Changes

- e389d54: Stop adding a created_at column to the export

## 3.0.0-alpha.17

### Major Changes

- dcf8977: Fix bach log's date and ordering. Requires db migration.

## 3.0.0-alpha.16

### Major Changes

- e06205c: Use accept header instead of querystring argument to specify expected log export format (csv/json).
- d082fc5: Fix log export sorting. Log server's log push now requires a date property. Log client's log now also requires a date property.

## 3.0.0-alpha.15

### Minor Changes

- f8328fb: Add the allowCrossOrigin and secureCookies parameters.

### Patch Changes

- fcc80ac: Fix adminPassword parameter not being used to login as admin (the env variable was used instead)
- 28ca982: Prevents admin login if no admin password was provided
- fdbab0f: Improve error messages when using createLogServer without the required arguments.

## 3.0.0-alpha.13

### Major Changes

- fe194ad: Remove support for non sqlite databases (for now). Break compatibility with previous versions of the database, with no provided migration.
- 5d83e28: Revamp the log server API.

### Minor Changes

- 00d2782: Always answer to a request with a JSON body

## 3.0.0-alpha.12

### Major Changes

- dae0dcb: First version of @lightmill/log-server
