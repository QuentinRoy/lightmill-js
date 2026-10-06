---
'@lightmill/log-server': patch
---

Fix the log export of `GET /logs`, `log-server export`, and `SQLiteDataStore#getLogs` skipping or interleaving logs. When a page of results ended inside a run without a name, the rest of that run and the experiment's later runs were missing, and the logs of runs that share a name, such as canceled runs, were interleaved and some skipped. The logs of each run now come together, and runs that share a name come in the order they were created.
