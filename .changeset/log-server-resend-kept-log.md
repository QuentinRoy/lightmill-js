---
'@lightmill/log-server': patch
---

Fix `POST /logs` and `POST /operations` answering `500` to a resend of a log that a resume kept, which clients retried until they paused. Such a resend is now a duplicate log: `POST /logs` answers `200` with the stored log's id. A log with that number but a different type or values answers `409 LOG_NUMBER_EXISTS`.
