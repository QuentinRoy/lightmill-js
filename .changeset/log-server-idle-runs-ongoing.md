---
'@lightmill/log-server': major
---

`POST /runs` let a session create a run while it held an `idle` run. It now answers `403 ONGOING_RUNS`, as it does for a `running` or `interrupted` run, since an idle run has not ended. Start or cancel the idle run before creating another.
