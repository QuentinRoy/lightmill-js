---
'@lightmill/log-client': minor
---

pr: #332
commit: 4f9aab622cdf819827ed1de3700ed8e972e7948f

`Logger#state` and `Logger#subscribe()` report log delivery and work with React's `useSyncExternalStore`. `state.status` is `idle`, `sending`, `retrying`, `paused`, or, once the run ends, `completed`, `canceled`, or `interrupted`. `subscribe()` calls its listener with each new state.
