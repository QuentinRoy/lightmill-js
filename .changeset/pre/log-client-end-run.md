---
'@lightmill/log-client': minor
---

pr: #332
commit: 4f9aab622cdf819827ed1de3700ed8e972e7948f

`flush()` now rejects only while logs it waits for are held after the logger pauses, instead of rethrowing the first error forever. `completeRun()` rejects while logs are held; `cancelRun()` and `interruptRun()` do too, unless passed `{ discardInFlightLogs: true }`, which drops them and rejects their `addLog()` promises. While a call ends the run, `addLog()` and other calls ending it reject.
