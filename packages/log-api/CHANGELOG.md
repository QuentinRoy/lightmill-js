# @lightmill/log-api

## 5.0.0

### Major Changes

- 6651c93: Removes typescript-openapi type export. The prefered way to rely on our contract's type is now to use the zod schemas directly. openapi.yaml is still being generated so typescript-openapi types can be generated from it if needed.
- 6651c93: Switch openapi.json export to openapi.yaml. This aligns with openapi most widespread use. Author should update their code to use openapi.yamd instead of .json, and switch to corresponding parser.
- 6651c93: Update validation error codes to be more explicit. Refer to openapi.yaml or the exported schemas to update your code if needed.

### Minor Changes

- 6651c93: Export zod schemas that may be used to validate request and reponses.

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
