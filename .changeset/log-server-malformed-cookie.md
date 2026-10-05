---
'@lightmill/log-server': patch
---

Fix every request answering `500 INTERNAL_SERVER_ERROR` when the `Cookie` header held a cookie the server could not parse, such as one another app on the same host set with malformed percent-encoding or without `=`.
