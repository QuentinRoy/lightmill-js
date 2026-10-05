---
'@lightmill/log-server': patch
---

Fix `POST /operations` answering `500` after storing the logs it accepted. It now answers `200` with their ids.
