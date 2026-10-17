---
'@lightmill/log-client': minor
---

Add `client.getRunLogs({ runId, logTypes })`, which lists a run's logs of the given types in log-number order, as `{ number, log }`, for example to replay a run. It leaves out the logs a resume canceled and stranded logs, the logs above a missing log number. With a `@lightmill/log-server` older than 5.0.2, the stranded logs are listed too. It reads the whole list before resolving.
