---
'@lightmill/log-server': patch
---

Fix `POST /logs` answering `500` to a resend of a log that a resume kept, for example after a lost response. It now answers `200` with the stored log's id, or `409 LOG_NUMBER_EXISTS` if the type or values differ.
