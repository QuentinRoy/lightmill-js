---
'@lightmill/log-server': major
---

A custom session store must return what it just saved when the same process reads it back: once `set` calls back, `get` returns that data. `POST /runs` and `DELETE /sessions/current` now read the session again after waiting for their turn, and use what the store returns. A store that reads from a copy of the data that can lag behind, or reports a write as done before it can be read, would give them an old session. The memory store and `SQLiteDataStore#getSessionStore()` are fine. If your store cannot promise this, use one of those instead.
