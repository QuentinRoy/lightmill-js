---
'@lightmill/log-server': patch
---

`POST /runs` returns `403 EXPERIMENT_NOT_FOUND` when the requested experiment does not exist.
