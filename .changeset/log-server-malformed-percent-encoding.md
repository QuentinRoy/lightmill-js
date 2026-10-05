---
'@lightmill/log-server': patch
---

Fix requests with malformed percent-encoding getting the wrong error. A malformed query string used to answer `500 INTERNAL_SERVER_ERROR` and now answers `400 INVALID_REQUEST_QUERY`; a malformed path parameter, such as `GET /sessions/%E0%A4%A`, used to answer `400 INVALID_REQUEST_BODY` and now answers `404 NOT_FOUND`. Query parameters are also decoded once instead of twice, so `%2526` reads as `%26`, not `&`.
