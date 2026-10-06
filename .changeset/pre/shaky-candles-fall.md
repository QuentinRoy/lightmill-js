---
'@lightmill/log-client': minor
---

`Client#startRun()` rejects with a `RequestError` instead of a plain `Error` when the server fails to look up the experiment or the run by name.
