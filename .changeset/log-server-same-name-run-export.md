---
'@lightmill/log-server': patch
---

Fix the log export of `GET /logs` and `SQLiteDataStore#getLogs` interleaving the logs of runs that share a name, such as canceled runs, and skipping some of them where a page ended. Logs now come grouped by run, in the order the runs were created.
