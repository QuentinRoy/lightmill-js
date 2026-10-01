---
'@lightmill/log-server': major
---

Custom `DataStore` implementations must return `created` with each log from `addLogs`: `true` for a stored log, `false` for a duplicate log already held by the run, which must be returned with its stored id and not stored again. A `DataStoreError` with `LOG_NUMBER_EXISTS_IN_SEQUENCE` must now carry the `logNumber` of the first log that conflicts.
