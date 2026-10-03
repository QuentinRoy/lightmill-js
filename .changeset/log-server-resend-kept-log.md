---
'@lightmill/log-server': patch
---

`POST /logs` and `POST /operations` accept a resend of a log that a resume kept, as they do any duplicate log: `POST /logs` answers `200` with the stored log's id. A log with that number but a different type or values answers `409 LOG_NUMBER_EXISTS`. Both used to answer a `500`, which clients retry.
