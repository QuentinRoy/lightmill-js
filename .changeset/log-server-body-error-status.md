---
'@lightmill/log-server': patch
---

Fix a malformed request body answering `400 INVALID_REQUEST_BODY` on a path that does not exist, with a method the path does not have, or with a `Content-Type` the route does not accept, such as `application/json`. These requests now answer `404`, `405`, and `415`. A body sent without a `Content-Type` header now answers `415 UNSUPPORTED_MEDIA_TYPE` instead of being ignored, or rejected as missing.
