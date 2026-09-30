---
'@lightmill/log-server': minor
---

Fix the `source.pointer` of `INVALID_REQUEST_BODY` errors. It is now `""` when
the whole request body is invalid (it was `"/"`), and `~` and `/` in keys are
escaped as `~0` and `~1`, as required by JSON Pointer (RFC 6901).
