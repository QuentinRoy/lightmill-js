---
'@lightmill/log-api': minor
---

`POST /runs` documents `INVALID_RUN_STATUS` among its `403` errors, for a run created with a status other than `idle` or `running`. `PATCH /runs/{id}` documents `403 IMMUTABLE_RUN_ATTRIBUTE`, for a `name` or an `experiment` relationship that differs from the run's, with a `source.pointer` to the offending attribute. Every route may answer `503 SERVICE_UNAVAILABLE` when the server could not process the request and saved nothing: the `Retry-After` header says when to try again.
