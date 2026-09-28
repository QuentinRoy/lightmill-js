---
'@lightmill/log-api': major
'@lightmill/log-server': major
'@lightmill/log-client': major
---

Run resources replace `missingLogNumbers` with `firstMissingLogNumber`: the lowest missing log number in the run's current log sequence, or `null` when none is missing. Listing every missing log number could not scale to a log number far ahead of the others. Completing a run with missing logs now fails with error code `MISSING_LOGS` instead of `PENDING_LOGS`, and its detail names the missing log number. `Logger#flush()` reads `firstMissingLogNumber`, so `@lightmill/log-client` needs a server of the same version; its `FlushError` now names the missing log number and says how to recover. Read `firstMissingLogNumber` where you read `missingLogNumbers[0]`, and match `MISSING_LOGS` where you matched `PENDING_LOGS`.
