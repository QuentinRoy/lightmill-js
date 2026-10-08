---
'@lightmill/log-server': patch
---

Answer unexpected server errors with a fixed `detail` instead of the error's own message, which could expose SQL, table names, or file paths. The message stays in the server log.
