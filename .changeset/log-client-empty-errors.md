---
'@lightmill/log-client': patch
---

Fix `RequestError` throwing a `TypeError` instead of building the error when a response body has an empty `errors` array.
