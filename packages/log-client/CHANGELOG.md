# @lightmill/log-client

## 5.0.0

### Major Changes

- [#327](https://github.com/QuentinRoy/lightmill-js/pull/327) [`80e09ae`](https://github.com/QuentinRoy/lightmill-js/commit/80e09aec0f3b8b981580d4f60daa13c6958b1a27) - `Logger#addLog()` sends logs in batches through `POST /operations`, one batch at a time, so a client far from the server no longer exhausts the browser's connections when logging at a high rate. Logs added while a batch waits for the server go in the next one, up to about 512 kB per batch. `addLog()` resolves once the server stores the log's batch. The `requestThrottle` option of `Client` now sets the minimum time in milliseconds between the starts of two batches (default `0`); `flush()` sends at once. A serializer that throws no longer uses up a log number. Needs a `@lightmill/log-server` that serves `POST /operations`: update the server before the client.

- [#315](https://github.com/QuentinRoy/lightmill-js/pull/315) [`6200bd3`](https://github.com/QuentinRoy/lightmill-js/commit/6200bd3952d87a3976c28a3b94d2f588ab75104b) - Run resources replace `missingLogNumbers` with `firstMissingLogNumber`: the lowest missing log number in the run's current log sequence, or `null` when none is missing. Listing every missing log number could not scale to a log number far ahead of the others. Completing a run with missing logs now fails with error code `MISSING_LOGS` instead of `PENDING_LOGS`, and its detail names the missing log number. `Logger#flush()` reads `firstMissingLogNumber`, so `@lightmill/log-client` needs a server of the same version; its `FlushError` now names the missing log number and says how to recover. Read `firstMissingLogNumber` where you read `missingLogNumbers[0]`, and match `MISSING_LOGS` where you matched `PENDING_LOGS`.

### Minor Changes

- [#471](https://github.com/QuentinRoy/lightmill-js/pull/471) [`4d67a62`](https://github.com/QuentinRoy/lightmill-js/commit/4d67a62c788f2a3dcf16def63f54b8f968423330) - Import `RequestError`, `AddLogError`, and `FlushError` from `@lightmill/log-client` to check failures with `instanceof` and access their properties in TypeScript.

- [#332](https://github.com/QuentinRoy/lightmill-js/pull/332) [`4f9aab6`](https://github.com/QuentinRoy/lightmill-js/commit/4f9aab622cdf819827ed1de3700ed8e972e7948f) - `flush()` now rejects only while logs it waits for are held after the logger pauses, instead of rethrowing the first error forever. `completeRun()` rejects while logs are held; `cancelRun()` and `interruptRun()` do too, unless passed `{ discardInFlightLogs: true }`, which drops them and rejects their `addLog()` promises. While a call ends the run, `addLog()` and other calls ending it reject.

- [#332](https://github.com/QuentinRoy/lightmill-js/pull/332) [`4f9aab6`](https://github.com/QuentinRoy/lightmill-js/commit/4f9aab622cdf819827ed1de3700ed8e972e7948f) - Once retries run out or the server answers with another error, the logger pauses: the failed batch's `addLog()` promises reject, and every other in-flight log is held with its promise pending, never dropped. `Logger#inFlightLogs` lists them, and `Logger#retry()` sends them again.

- [#332](https://github.com/QuentinRoy/lightmill-js/pull/332) [`4f9aab6`](https://github.com/QuentinRoy/lightmill-js/commit/4f9aab622cdf819827ed1de3700ed8e972e7948f) - The logger retries a batch of logs that fails with a network error, a timeout, a 5xx, a `408`, or a `429` (waiting for `Retry-After`), for up to 2 minutes, waiting a little longer, at random, before each attempt. A request times out after `requestTimeout.base` milliseconds plus `requestTimeout.perKilobyte` milliseconds per kilobyte sent, a new `Client` option (defaults 10000 and 100). A batch the server rejects with `413` is resent in halves. The missing log number check of `flush()` and the request ending a run are retried the same way.

- [#332](https://github.com/QuentinRoy/lightmill-js/pull/332) [`4f9aab6`](https://github.com/QuentinRoy/lightmill-js/commit/4f9aab622cdf819827ed1de3700ed8e972e7948f) - `Logger#state` and `Logger#subscribe()` report log delivery and work with React's `useSyncExternalStore`. `state.status` is `idle`, `sending`, `retrying`, `paused`, or, once the run ends, `completed`, `canceled`, or `interrupted`. `subscribe()` calls its listener with each new state.

- [#270](https://github.com/QuentinRoy/lightmill-js/pull/270) [`9f107be`](https://github.com/QuentinRoy/lightmill-js/commit/9f107bec5b15ddb4b35e26c49f1f50f37599d7fd) - `Client#startRun()` rejects with a `RequestError` instead of a plain `Error` when the server fails to look up the experiment or the run by name.

### Patch Changes

- [#406](https://github.com/QuentinRoy/lightmill-js/pull/406) [`888bf8f`](https://github.com/QuentinRoy/lightmill-js/commit/888bf8fa926337d67bf7c684314687b28880de74) - Fix `Client` methods throwing a `TypeError` instead of a `RequestError` when the failed response had no body (`Content-Length: 0`).

- [#402](https://github.com/QuentinRoy/lightmill-js/pull/402) [`7a290b2`](https://github.com/QuentinRoy/lightmill-js/commit/7a290b2dd900c12a252ce43778ebc65b3804b42b) - Fix `Client#startRun()` omitting credentials from the experiment lookup, the run lookup by name, and the session creation, so a cross-origin server neither received nor set the session cookie. `startRun()` now rejects with a `RequestError` when the server refuses to create the session, instead of carrying on without one.
- Updated dependencies [[`6651c93`](https://github.com/QuentinRoy/lightmill-js/commit/6651c93dadb2403ac084f61676df2a792f01891c), [`6651c93`](https://github.com/QuentinRoy/lightmill-js/commit/6651c93dadb2403ac084f61676df2a792f01891c), [`468a0f9`](https://github.com/QuentinRoy/lightmill-js/commit/468a0f9a01f23d7680753c4244cf9a23f9e61c8c), [`bbcb236`](https://github.com/QuentinRoy/lightmill-js/commit/bbcb236a538f3b185bde94da31c95fcd78b49d1e), [`7828de4`](https://github.com/QuentinRoy/lightmill-js/commit/7828de4b0102904b4936c99be3e64b6660007e6a), [`f3d556d`](https://github.com/QuentinRoy/lightmill-js/commit/f3d556defdb58845ec79884446135cc6f577e596), [`1968561`](https://github.com/QuentinRoy/lightmill-js/commit/1968561109828d73952f465409053ab00cdaf3f9), [`8c93c4d`](https://github.com/QuentinRoy/lightmill-js/commit/8c93c4d00b90160c911f19b7e7ac388f53d6af33), [`bbcb236`](https://github.com/QuentinRoy/lightmill-js/commit/bbcb236a538f3b185bde94da31c95fcd78b49d1e), [`6abfe1b`](https://github.com/QuentinRoy/lightmill-js/commit/6abfe1b27e852b8af7b284816140c5b6ab77082b), [`6200bd3`](https://github.com/QuentinRoy/lightmill-js/commit/6200bd3952d87a3976c28a3b94d2f588ab75104b), [`6651c93`](https://github.com/QuentinRoy/lightmill-js/commit/6651c93dadb2403ac084f61676df2a792f01891c)]:
  - @lightmill/log-api@5.0.0

## 5.0.0-beta.4

### Patch Changes

- Updated dependencies [[`bbcb236`](https://github.com/QuentinRoy/lightmill-js/commit/bbcb236a538f3b185bde94da31c95fcd78b49d1e), [`1968561`](https://github.com/QuentinRoy/lightmill-js/commit/1968561109828d73952f465409053ab00cdaf3f9), [`bbcb236`](https://github.com/QuentinRoy/lightmill-js/commit/bbcb236a538f3b185bde94da31c95fcd78b49d1e), [`6abfe1b`](https://github.com/QuentinRoy/lightmill-js/commit/6abfe1b27e852b8af7b284816140c5b6ab77082b)]:
  - @lightmill/log-api@5.0.0-beta.4

## 5.0.0-beta.2

### Major Changes

- [#327](https://github.com/QuentinRoy/lightmill-js/pull/327) [`80e09ae`](https://github.com/QuentinRoy/lightmill-js/commit/80e09aec0f3b8b981580d4f60daa13c6958b1a27) - `Logger#addLog()` sends logs in batches through `POST /operations`, one batch at a time, so a client far from the server no longer exhausts the browser's connections when logging at a high rate. Logs added while a batch waits for the server go in the next one, up to about 512 kB per batch. `addLog()` resolves once the server stores the log's batch. The `requestThrottle` option of `Client` now sets the minimum time in milliseconds between the starts of two batches (default `0`); `flush()` sends at once. A serializer that throws no longer uses up a log number. Needs a `@lightmill/log-server` that serves `POST /operations`: update the server before the client.

### Minor Changes

- [#332](https://github.com/QuentinRoy/lightmill-js/pull/332) [`4f9aab6`](https://github.com/QuentinRoy/lightmill-js/commit/4f9aab622cdf819827ed1de3700ed8e972e7948f) - `flush()` now rejects only while logs it waits for are held after the logger pauses, instead of rethrowing the first error forever. `completeRun()` rejects while logs are held; `cancelRun()` and `interruptRun()` do too, unless passed `{ discardInFlightLogs: true }`, which drops them and rejects their `addLog()` promises. While a call ends the run, `addLog()` and other calls ending it reject.

- [#332](https://github.com/QuentinRoy/lightmill-js/pull/332) [`4f9aab6`](https://github.com/QuentinRoy/lightmill-js/commit/4f9aab622cdf819827ed1de3700ed8e972e7948f) - Once retries run out or the server answers with another error, the logger pauses: the failed batch's `addLog()` promises reject, and every other in-flight log is held with its promise pending, never dropped. `Logger#inFlightLogs` lists them, and `Logger#retry()` sends them again.

- [#332](https://github.com/QuentinRoy/lightmill-js/pull/332) [`4f9aab6`](https://github.com/QuentinRoy/lightmill-js/commit/4f9aab622cdf819827ed1de3700ed8e972e7948f) - The logger retries a batch of logs that fails with a network error, a timeout, a 5xx, a `408`, or a `429` (waiting for `Retry-After`), for up to 2 minutes, waiting a little longer, at random, before each attempt. A request times out after `requestTimeout.base` milliseconds plus `requestTimeout.perKilobyte` milliseconds per kilobyte sent, a new `Client` option (defaults 10000 and 100). A batch the server rejects with `413` is resent in halves. The missing log number check of `flush()` and the request ending a run are retried the same way.

- [#332](https://github.com/QuentinRoy/lightmill-js/pull/332) [`4f9aab6`](https://github.com/QuentinRoy/lightmill-js/commit/4f9aab622cdf819827ed1de3700ed8e972e7948f) - `Logger#state` and `Logger#subscribe()` report log delivery and work with React's `useSyncExternalStore`. `state.status` is `idle`, `sending`, `retrying`, `paused`, or, once the run ends, `completed`, `canceled`, or `interrupted`. `subscribe()` calls its listener with each new state.

## 5.0.0-beta.1

### Major Changes

- [#315](https://github.com/QuentinRoy/lightmill-js/pull/315) [`6200bd3`](https://github.com/QuentinRoy/lightmill-js/commit/6200bd3952d87a3976c28a3b94d2f588ab75104b) - Run resources replace `missingLogNumbers` with `firstMissingLogNumber`: the lowest missing log number in the run's current log sequence, or `null` when none is missing. Listing every missing log number could not scale to a log number far ahead of the others. Completing a run with missing logs now fails with error code `MISSING_LOGS` instead of `PENDING_LOGS`, and its detail names the missing log number. `Logger#flush()` reads `firstMissingLogNumber`, so `@lightmill/log-client` needs a server of the same version; its `FlushError` now names the missing log number and says how to recover. Read `firstMissingLogNumber` where you read `missingLogNumbers[0]`, and match `MISSING_LOGS` where you matched `PENDING_LOGS`.

## 5.0.0-beta.0

### Minor Changes

- [#270](https://github.com/QuentinRoy/lightmill-js/pull/270) [`9f107be`](https://github.com/QuentinRoy/lightmill-js/commit/9f107bec5b15ddb4b35e26c49f1f50f37599d7fd) - Slightly improve some client's errors.

## 4.0.0

### Major Changes

- c038515: Include `name: null` as a run attribute in the POST request when creating a run without a name, to comply with changes in `@lightmill/log-api` that require unnamed runs to explicitly specify `null` for `name`.
- f45d00d: `Logger#flush` now only waits for logs that were added before it was called. This allows users to continue adding logs while waiting for the flush to resolve, and makes its behavior more deterministic when logs are added continuously.
- 8b648f9: Changes the content type of every post or patch requests to `application/vnd.api+json` to match the new API.

### Minor Changes

- e89e3d0: `Logger#flush` now checks for missing logs on the server and fails if any are missing that were added prior to the flush call. This is considered a minor change, as it primarily surfaces existing issues (such as communication errors) earlier.

## 3.1.1

### Patch Changes

- 0572f38: Fix failed requests not being properly handled.

## 3.0.3

### Patch Changes

- 87d6281: Fix flush stalling when called multiple times without awaiting.

## 3.0.0

### Major Changes

New log client package to work with the new log api and the new log server.

## 3.0.0-beta.34

### Major Changes

- adccc07: new api

## 3.0.0-beta.33

### Major Changes

- 12752c2: Drop support to older log-server versions

## 3.0.0-beta.28

### Patch Changes

- 1567f93: Fix resuming a log when there are no matching logs found.

## 3.0.0-beta.25

### Patch Changes

- 2d3d87e: Remove package.json engines directive which fixes a warning when consumer uses a different node version.
- Updated dependencies [2d3d87e]
  - @lightmill/log-api@3.0.0-beta.25

## 3.0.0-beta.23

### Major Changes

- 956791f: Now complies with the new log-server API.
- 5b3eecd: Update client to match new log api. Old server will not work with this client.
- b426249: Change log api HTTP method to update run status: switch to patch instead of put.

### Minor Changes

- aed9788: Log client logout
- aed9788: resumeRun returns the log after which the run has been resumed

### Patch Changes

- Updated dependencies [5b3eecd]
- Updated dependencies [aed9788]
- Updated dependencies [aed9788]
- Updated dependencies [b426249]
- Updated dependencies [9021cd4]
  - @lightmill/log-api@3.0.0-beta.23

## 3.0.0-beta.22

### Patch Changes

- Updated dependencies [97ea257]
- Updated dependencies [4ba84e4]
- Updated dependencies [4ba84e4]
- Updated dependencies [97ea257]
- Updated dependencies [4ba84e4]
  - @lightmill/log-server@3.0.0-beta.22

## 3.0.0-beta.21

### Patch Changes

- 06505dd: fix flushing being ignored when log queue only contains one log

## 3.0.0-beta.19

### Patch Changes

- Updated dependencies [e3c47af]
  - @lightmill/log-server@3.0.0-beta.19

## 3.0.0-alpha.18

### Patch Changes

- Updated dependencies [e389d54]
  - @lightmill/log-server@3.0.0-alpha.18

## 3.0.0-alpha.17

### Patch Changes

- Updated dependencies [dcf8977]
  - @lightmill/log-server@3.0.0-alpha.17

## 3.0.0-alpha.16

### Major Changes

- d082fc5: Fix log export sorting. Log server's log push now requires a date property. Log client's log now also requires a date property.

### Patch Changes

- Updated dependencies [e06205c]
- Updated dependencies [d082fc5]
  - @lightmill/log-server@3.0.0-alpha.16

## 3.0.0-alpha.15

### Major Changes

- 64594f3: Rename the log method to addLog to match react-experiment's Logger type.

### Minor Changes

- f5fc857: Ignore undefined log props

### Patch Changes

- c9b3ef1: Fix post log url and request authentications (include credentials in requests)
- 8e9fa76: Prevent RunClient to be created without knowing how to serialize all the type of logs it accepts.
- Updated dependencies [fcc80ac]
- Updated dependencies [f8328fb]
- Updated dependencies [28ca982]
- Updated dependencies [fdbab0f]
  - @lightmill/log-server@3.0.0-alpha.15

## 3.0.0-alpha.14

### Patch Changes

- a0dd9be: Fix main export name: RunLogger -> LogClient

## 3.0.0-alpha.13

### Minor Changes

- 0185591: Creation of a new log client package.

### Patch Changes

- Updated dependencies [fe194ad]
- Updated dependencies [00d2782]
- Updated dependencies [5d83e28]
  - @lightmill/log-server@3.0.0-alpha.13
