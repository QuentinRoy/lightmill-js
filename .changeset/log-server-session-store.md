---
'@lightmill/log-server': minor
---

`SQLiteDataStore#getSessionStore()` returns an `express-session` store that persists sessions in the data store's database. Pass it to `LogServer` as `sessionStore` so participants can resume runs after a restart. A session lives as long as its cookie (`sessionMaxAge`), or one day if the cookie has no expiry. Run `migrateDatabase()` first. Close the HTTP server before the data store: closing the data store ends its session store.
