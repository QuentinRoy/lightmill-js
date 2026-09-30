---
'@lightmill/log-server': minor
---

Every route accepts request bodies up to 1 MB, up from 100 kB. A larger body gets a `413 REQUEST_BODY_TOO_LARGE`, and a body that is not valid JSON a `400 INVALID_REQUEST_BODY`, both JSON:API errors instead of a `500`.
