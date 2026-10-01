---
'@lightmill/log-client': minor
---

The logger retries a batch of logs that fails with a network error, a timeout, a 5xx, a `408`, or a `429` (waiting for `Retry-After`), for up to 2 minutes, waiting a little longer, at random, before each attempt. A request times out after `requestTimeout.base` milliseconds plus `requestTimeout.perKilobyte` milliseconds per kilobyte sent, a new `Client` option (defaults 10000 and 100). A batch the server rejects with `413` is resent in halves. The missing log number check of `flush()` and the request ending a run are retried the same way.
