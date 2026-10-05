---
'@lightmill/log-server': patch
---

Fix `GET /logs/{id}` ignoring the `include` query parameter, and `GET /sessions/{id}` ignoring `runs.experiment` and `runs.lastLogs` in it: they returned no `included` resources.
