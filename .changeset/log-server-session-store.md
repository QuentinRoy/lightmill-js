---
'@lightmill/log-server': minor
---

`SQLiteDataStore#getSessionStore()` returns an `express-session` store that persists sessions in the data store's database. Pass it to `LogServer` as `sessionStore` so participants can resume runs after a restart. Run `migrateDatabase()` first, and close the data store, which ends its session store, after the HTTP server. A session whose cookie has no expiry (no `sessionMaxAge`) lives one day.
