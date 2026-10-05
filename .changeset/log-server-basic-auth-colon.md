---
'@lightmill/log-server': patch
---

Fix host authentication rejecting passwords containing a colon, and answering a malformed `Authorization` header with a `500` instead of a `403`.
