---
'@lightmill/log-server': minor
---

Every route accepts request bodies up to 1 MB, up from 100 kB. A larger body gets a `413 REQUEST_BODY_TOO_LARGE`, a body that is not valid JSON a `400 INVALID_REQUEST_BODY`, and a body with an encoding the server cannot decode a `415 UNSUPPORTED_MEDIA_TYPE`, all JSON:API errors instead of a `500`.
