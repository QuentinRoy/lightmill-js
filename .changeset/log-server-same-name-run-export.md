---
'@lightmill/log-server': patch
---

pr: #415
commit: ee9238d9bc176d6a11454924ee6a100c1b8effd0

Fix the log export of `GET /logs` and `SQLiteDataStore#getLogs` interleaving the logs of runs that share a name, such as canceled runs, and skipping some of them where a page ended. Logs now come grouped by run, in the order the runs were created.
