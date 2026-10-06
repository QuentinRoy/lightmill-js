---
'@lightmill/log-api': major
---

`PATCH /runs/{id}` documents `lastLogNumber` as resuming the run, so it requires the status `running`, or no status on a running run. A `lastLogNumber` sent with another status is an invalid request body: `400 INVALID_REQUEST_BODY`, with a `source.pointer` to `/data/attributes/lastLogNumber`. Sent without a status on a run that is not running, it gets `403 INVALID_LAST_LOG_NUMBER`. Send `lastLogNumber` only to resume a run.
