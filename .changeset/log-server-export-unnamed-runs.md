---
'@lightmill/log-server': patch
---

Fix `GET /logs` and the CLI export silently skipping logs when a page of results ended inside a run without a name: the rest of that run and the experiment's later runs were missing from the export.
