---
'@lightmill/log-api': minor
---

`POST /logs`, `POST /operations` and `PATCH /runs/{id}` document a `403 RUN_NOT_OWNED` error, for a write to a run another session created.
