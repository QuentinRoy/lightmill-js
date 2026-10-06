---
'@lightmill/log-server': patch
---

Fix the server answering `500 INTERNAL_SERVER_ERROR` to every request for stored data the API schemas do not expect: `GET /experiments` failed for everyone once an experiment had an empty name.
