---
'@lightmill/log-server': patch
---

Fix the log export of `GET /logs` and `SQLiteDataStore#getLogs` stopping after the first page for runs without a name, which cut a CSV or JSON export short without an error.
