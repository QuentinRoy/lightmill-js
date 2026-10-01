---
'@lightmill/log-api': minor
---

`POST /logs` and `POST /operations` document the `413 REQUEST_BODY_TOO_LARGE` error returned when the request body is over 1 MB. `INVALID_REQUEST_BODY` errors may come without `source`, when the request body is not valid JSON.
