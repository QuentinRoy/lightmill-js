---
'@lightmill/log-server': patch
---

Fix requests with malformed percent-encoding getting the wrong error. A malformed query parameter, such as `GET /experiments?filter[name]=%E0%A4%A`, used to answer `500 INTERNAL_SERVER_ERROR` and now answers `400 INVALID_REQUEST_QUERY`; a malformed path parameter, such as `GET /sessions/%E0%A4%A`, used to answer `400 INVALID_REQUEST_BODY` and now answers `404 NOT_FOUND`.
