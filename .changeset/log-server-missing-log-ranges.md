---
'@lightmill/log-server': major
---

A log number far ahead of a run's other logs no longer crashes the server. `DataStore#getMissingLogs` is removed, since listing every missing log number is what made such logs crash it: read `firstMissingLogNumber` and `lastLogNumber` from `DataStore#getRuns` records instead, and provide them in custom `DataStore` implementations. Run resources now list only the first missing log number in `missingLogNumbers`.
