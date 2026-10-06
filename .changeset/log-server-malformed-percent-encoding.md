---
'@lightmill/log-server': patch
---

Fix requests with malformed percent-encoding answering `500 INTERNAL_SERVER_ERROR`. A malformed query parameter, such as `GET /experiments?filter[name]=%E0%A4%A`, now answers `400 INVALID_REQUEST_QUERY`, and a malformed path parameter, such as `GET /sessions/%E0%A4%A`, answers `404 NOT_FOUND`.
