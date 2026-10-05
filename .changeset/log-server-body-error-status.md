---
'@lightmill/log-server': patch
---

Fix some requests answering `400 INVALID_REQUEST_BODY` because their body was not valid JSON, when the request had a more basic problem. A path that does not exist now answers `404`, a method the path does not have `405`, and a `Content-Type` the route does not accept, such as `application/json`, `415`. A body sent without a `Content-Type` header now answers `415 UNSUPPORTED_MEDIA_TYPE` instead of being ignored, or rejected as missing.
