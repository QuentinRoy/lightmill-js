---
'@lightmill/log-client': patch
---

Fix `Client` methods throwing a `TypeError` instead of a `RequestError`, and a `Logger` neither resending a `413` batch in halves nor waiting for the `Retry-After` of a `429`, when the failed response had no body (`Content-Length: 0`).
