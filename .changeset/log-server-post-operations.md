---
'@lightmill/log-server': minor
---

`POST /operations` adds many logs of one run in a single request, all or nothing, and answers `200` with the id of each log, in order. Logs the run already holds with the same number, type, and values succeed like new ones. A number repeated within the request, or logs of several runs, get a `400`, and a number stored with different content gets a `409 LOG_NUMBER_EXISTS`, both pointing at the offending operation.
