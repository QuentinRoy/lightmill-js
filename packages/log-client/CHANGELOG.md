# @lightmill/log-client

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
