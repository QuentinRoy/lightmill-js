---
'@lightmill/log-server': patch
---

Fix `GET /logs`, `GET /logs/{id}` and `GET /sessions/{id}` returning compound documents that break JSON:API. A nested `include` such as `run.experiment` now also returns the resources on its path (the runs), and a last log that is already in `data` is no longer repeated in `included`.
