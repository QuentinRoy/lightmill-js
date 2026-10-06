---
'@lightmill/log-server': patch
---

Fix `POST /runs` answering `500` for an experiment that does not exist. It now answers `403 EXPERIMENT_NOT_FOUND`.
