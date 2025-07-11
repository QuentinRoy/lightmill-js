# @lightmill/log-server

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
