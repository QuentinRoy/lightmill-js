---
'@lightmill/log-server': patch
---

Fix `GET /logs/{id}` ignoring the `include` query parameter, and `GET /sessions/{id}` ignoring `include=runs.experiment` and `include=runs.lastLogs`: they returned no `included` resources. For `GET /logs/{id}`, `run`, `run.experiment` and `run.lastLogs` now work. For `GET /sessions/{id}`, only `runs` worked before.
