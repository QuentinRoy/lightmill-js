---
'@lightmill/log-server': minor
---

`POST /logs` accepts a log that is already stored, with the same number, type, and values, and returns the stored log's id instead of `409 LOG_NUMBER_EXISTS`. A log with the same number but different content still gets a `409`.
