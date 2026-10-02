# @lightmill/log-api

## 5.0.0-beta.2

### Minor Changes

- [#326](https://github.com/QuentinRoy/lightmill-js/pull/326) [`468a0f9`](https://github.com/QuentinRoy/lightmill-js/commit/468a0f9a01f23d7680753c4244cf9a23f9e61c8c) - `POST /logs` and `POST /operations` document the `413 REQUEST_BODY_TOO_LARGE` error returned when the request body is over 1 MB. `INVALID_REQUEST_BODY` errors may come without `source`, when the request body is not valid JSON.

- [#323](https://github.com/QuentinRoy/lightmill-js/pull/323) [`7828de4`](https://github.com/QuentinRoy/lightmill-js/commit/7828de4b0102904b4936c99be3e64b6660007e6a) - `POST /logs` documents a `200` response, for a log the run already holds with the same number, type, and values.

- [#324](https://github.com/QuentinRoy/lightmill-js/pull/324) [`f3d556d`](https://github.com/QuentinRoy/lightmill-js/commit/f3d556defdb58845ec79884446135cc6f577e596) - `POST /operations` documents adding many logs of one run in a single request, as a JSON:API Atomic Operations request (`atomic:operations` of `add` operations) sent with the `application/vnd.api+json;ext="https://jsonapi.org/ext/atomic"` media type.

## 5.0.0-beta.1

### Major Changes

- [#315](https://github.com/QuentinRoy/lightmill-js/pull/315) [`6200bd3`](https://github.com/QuentinRoy/lightmill-js/commit/6200bd3952d87a3976c28a3b94d2f588ab75104b) - Run resources replace `missingLogNumbers` with `firstMissingLogNumber`: the lowest missing log number in the run's current log sequence, or `null` when none is missing. Listing every missing log number could not scale to a log number far ahead of the others. Completing a run with missing logs now fails with error code `MISSING_LOGS` instead of `PENDING_LOGS`, and its detail names the missing log number. `Logger#flush()` reads `firstMissingLogNumber`, so `@lightmill/log-client` needs a server of the same version; its `FlushError` now names the missing log number and says how to recover. Read `firstMissingLogNumber` where you read `missingLogNumbers[0]`, and match `MISSING_LOGS` where you matched `PENDING_LOGS`.

## 5.0.0-beta.0

### Major Changes

- [#270](https://github.com/QuentinRoy/lightmill-js/pull/270) [`6651c93`](https://github.com/QuentinRoy/lightmill-js/commit/6651c93dadb2403ac084f61676df2a792f01891c) - Removes typescript-openapi type export. The prefered way to rely on our contract's type is now to use the zod schemas directly. openapi.yaml is still being generated so typescript-openapi types can be generated from it if needed.

- [#270](https://github.com/QuentinRoy/lightmill-js/pull/270) [`6651c93`](https://github.com/QuentinRoy/lightmill-js/commit/6651c93dadb2403ac084f61676df2a792f01891c) - Switch `openapi.json` export to `openapi.yaml`. This aligns with openapi most widespread use. Author should update their code to use `openapi.yaml` instead of `openapi.json`, and switch to corresponding parser.

- [#270](https://github.com/QuentinRoy/lightmill-js/pull/270) [`6651c93`](https://github.com/QuentinRoy/lightmill-js/commit/6651c93dadb2403ac084f61676df2a792f01891c) - Update validation error codes to be more explicit. Refer to openapi.yaml or the exported schemas to update your code if needed.

### Minor Changes

- [#270](https://github.com/QuentinRoy/lightmill-js/pull/270) [`6651c93`](https://github.com/QuentinRoy/lightmill-js/commit/6651c93dadb2403ac084f61676df2a792f01891c) - Export zod schemas that may be used to validate request and reponses.

## 4.0.1

### Patch Changes

- 0c369fc: Fixed the `Accept` header handling for `GET /logs`, which was previously restricted to specific values like `application/vnd+json` or `text/css`. This prevented the endpoint from being accessed via a simple link in an HTML page. It is now accessible without requiring a custom `Accept` header.

## 4.0.0

### Major Changes

- 36607bc: The API now requires the Content-Type header to be explicitly set to `application/vnd.api+json` on all requests. Previously, this header was optional. This change aligns our API with the JSON API specification requirements.
- 9d4c3b1: Run resources now include the list of missing log numbers for the run.
- 4cdd8e6: The `name` attribute of the `run` resource is now mandatory. To improve consistency and avoid ambiguity, runs without a name must now explicitly set `name: null` instead of omitting the field.

## 3.0.0

### Major Changes

New log api package to export server api contract and types.

## 3.0.0-beta.34

### Major Changes

- 0f22dda: narrow types of runStatus prop in createNewRun endpoint's answer

## 3.0.0-beta.33

### Major Changes

- 07e75b4: Entirely revise the rest API and exported types.

## 3.0.0-beta.25

### Patch Changes

- 2d3d87e: Remove package.json engines directive which fixes a warning when consumer uses a different node version.

## 3.0.0-beta.23

### Major Changes

- 5b3eecd: Update log api : date isn't required anymore to save a log, but number is. Number is used to order logs, but also detect missing logs which date was not able to do.
- b426249: Change log api HTTP method to update run status: switch to patch instead of put.
- 9021cd4: Creation

### Minor Changes

- aed9788: Add endpoint to get run info
- aed9788: Add the ability to resume a running or canceled run.
