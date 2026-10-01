---
'@lightmill/log-server': minor
---

Requests may carry a `profile` parameter in their `Content-Type`, which is ignored, and the media type is matched regardless of case. Other parameters, such as `charset`, still get a `415`.
