---
'@lightmill/log-api': patch
---

Accept a single `include` value on `GET /sessions/{id}`, like the run and log routes. `GET /sessions/current?include=runs` used to answer `400 INVALID_REQUEST_QUERY`.
