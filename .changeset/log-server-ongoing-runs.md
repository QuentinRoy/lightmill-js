---
'@lightmill/log-server': patch
---

`PATCH /runs/{id}` no longer answers `403 ONGOING_RUNS` because the session has another ongoing run.
