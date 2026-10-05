---
'@lightmill/log-server': patch
---

Fix `POST /operations` answering some errors with the plain JSON:API media type instead of the atomic operations one: an unsupported `Content-Type` (`415`), another method on `/operations` (`405`), and an unexpected server error (`500`).
