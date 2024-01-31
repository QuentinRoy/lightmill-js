---
'@lightmill/log-server': minor
---

Add a select query result limit for SQliteStore to prevent too many logs to be loaded in memory at the same time. Once the limit is attained logs are yielded and the next logs are loaded once their done being processed.
