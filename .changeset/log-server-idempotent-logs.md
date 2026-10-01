---
'@lightmill/log-server': minor
---

`POST /logs` accepts a log already stored with the same number, type, and values, and answers `200` with the stored log's id instead of `409 LOG_NUMBER_EXISTS`. A new log still gets `201`, and a log with the same number but different content still gets a `409`.
