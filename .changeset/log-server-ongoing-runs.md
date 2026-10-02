---
'@lightmill/log-server': patch
---

`idle` runs count as ongoing. `POST /runs` refuses to create a run while the session has one, where it only looked at `running` and `interrupted` runs. `PATCH /runs/{id}` no longer answers `403 ONGOING_RUNS` because the session has another ongoing run.
