# @lightmill/log-client

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
