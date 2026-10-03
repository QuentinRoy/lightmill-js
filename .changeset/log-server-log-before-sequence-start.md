---
'@lightmill/log-server': patch
'@lightmill/log-api': minor
---

`POST /logs` and `POST /operations` answer `409 LOG_NUMBER_BEFORE_SEQUENCE_START` instead of a `500` for a log numbered below the start of the run's current log sequence, set by its last resume, even when the log is identical to one the run kept. `POST /operations` stores none of the batch and points at the offending log with `source.pointer`. The log can never be stored, so a client should not retry it.
