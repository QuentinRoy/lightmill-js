---
'@lightmill/log-client': patch
---

Fix `Client` methods throwing a `TypeError` instead of a `RequestError` when the failed response had no body (`Content-Length: 0`).
