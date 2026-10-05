---
'@lightmill/log-client': patch
---

Fix a failed response with no body (`Content-Length: 0`) being read as a success. `Client` methods threw a `TypeError` instead of a `RequestError`, and a `Logger` retried the batch with that `TypeError` as the error: a batch rejected with such a `413` was never resent in halves, and such a `429` was retried without waiting for `Retry-After`.
