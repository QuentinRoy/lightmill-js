---
"@lightmill/log-api": patch
---

Fixed the `Accept` header handling for `GET /logs`, which was previously restricted to specific values like `application/vnd+json` or `text/css`. This prevented the endpoint from being accessed via a simple link in an HTML page. It is now accessible without requiring a custom `Accept` header.
