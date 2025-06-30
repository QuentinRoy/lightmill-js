# @lightmill/log-api

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
