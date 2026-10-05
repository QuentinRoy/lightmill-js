---
'@lightmill/log-server': patch
---

Fix `GET /logs` crashing the server, or leaving the request hanging, when reading the logs failed after the response had started. The request is now aborted and the server keeps running.
