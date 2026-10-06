---
'@lightmill/log-server': patch
---

Fix a request body sent without a `Content-Type` header being ignored, or rejected as missing. It now answers `415 UNSUPPORTED_MEDIA_TYPE`.
