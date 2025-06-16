---
'@lightmill/log-server': major
---

`Store.migrateDatabase` now throws on error instead of resolving with a result. On success, it resolves with void. Previously, it returned Kysely’s migration result and did not throw on failure, which made it harder to implement alternative solutions without relying on Kysely.
