---
'@lightmill/log-api': major
'@lightmill/log-server': major
---

`PATCH /runs/{id}` refuses a `lastLogNumber` sent with a status other than `running` as an invalid request body: `400 INVALID_REQUEST_BODY`, with a `source.pointer` to `/data/attributes/lastLogNumber`. It used to answer `403 INVALID_LAST_LOG_NUMBER`. The schema now describes `lastLogNumber`: it resumes the run, so it requires the status `running`, or no status on a running run. A `lastLogNumber` without a status on a run that is not running still answers `403 INVALID_LAST_LOG_NUMBER`. Update clients that handle `403 INVALID_LAST_LOG_NUMBER` for the first case.
