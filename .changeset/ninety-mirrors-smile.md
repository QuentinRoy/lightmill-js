---
"@lightmill/log-server": patch
---

Fixed handling of the `q=` weighting factor in the `Accept` header for `GET /logs`. Previously, it was not supported and could cause requests to fail. The server now correctly interprets `q=` values and returns the preferred media type accordingly.