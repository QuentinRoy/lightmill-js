---
'@lightmill/log-server': patch
---

A request that fails because the database is busy, for example locked by the `log-server` CLI, answers `503 SERVICE_UNAVAILABLE` with `Retry-After: 1` instead of a `500`. Nothing was saved, so the request can be sent again.
