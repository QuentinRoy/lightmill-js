---
'@lightmill/log-server': major
---

Update server to comply with new API contract. Post and put requests are now required to use `application/vnd.api+json` as content type. Responses' content type is now `application/vnd.api+json` (except when responding with CSV content).
