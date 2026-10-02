---
'@lightmill/log-server': patch
---

`POST /runs` refuses to create a run while the session has an `idle` run, where it only looked at `running` and `interrupted` runs. The `403 ONGOING_RUNS` message now says "runs that haven't ended". `PATCH /runs/{id}` no longer answers `403 ONGOING_RUNS` because the session has another ongoing run.
