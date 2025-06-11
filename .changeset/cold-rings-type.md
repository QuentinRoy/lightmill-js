---
'@lightmill/log-api': major
---

The API now requires the Content-Type header to be explicitly set to `application/vnd.api+json` on all requests. Previously, this header was optional. This change aligns our API with the JSON API specification requirements.