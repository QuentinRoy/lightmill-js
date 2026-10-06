---
'@lightmill/log-api': major
'@lightmill/log-server': major
---

Rename error codes to say what failed: `BODY_VALIDATION` is now `INVALID_REQUEST_BODY`, `HEADERS_VALIDATION` is `INVALID_REQUEST_HEADERS`, `QUERY_VALIDATION` is `INVALID_REQUEST_QUERY`, `INVALID_QUERY_PARAMETER` is `NOT_SUPPORTED_QUERY_PARAMETER`, and `INTERNAL_SERVER` is `INTERNAL_SERVER_ERROR`. `POST /sessions` answers `403 MISSING_CREDENTIALS` to a host session requested without an `Authorization` header. Update code that matches the old codes.
