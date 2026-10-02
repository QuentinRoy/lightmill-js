---
'@lightmill/log-client': minor
---

pr: #332
commit: 4f9aab622cdf819827ed1de3700ed8e972e7948f

Once retries run out or the server answers with another error, the logger pauses: the failed batch's `addLog()` promises reject, and every other in-flight log is held with its promise pending, never dropped. `Logger#inFlightLogs` lists them, and `Logger#retry()` sends them again.
