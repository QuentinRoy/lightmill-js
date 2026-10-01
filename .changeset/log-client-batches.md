---
'@lightmill/log-client': minor
---

`Logger#addLog()` sends logs in batches through `POST /operations`, one batch at a time, so a client far from the server no longer exhausts the browser's connections when logging at a high rate. Logs added while a batch waits for the server go in the next one, up to about 512 kB per batch. `addLog()` resolves once the server stores the log's batch. The `requestThrottle` option of `Client` now sets the minimum time in milliseconds between the starts of two batches (default `0`); `flush()` sends at once. A serializer that throws no longer uses up a log number. Needs a `@lightmill/log-server` that serves `POST /operations`.
