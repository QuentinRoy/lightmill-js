---
'@lightmill/log-server': major
---

Renamed `SqliteStore` to `SqliteDataStore` to avoid confusion with other store types (e.g., session store) used in the system. This is a breaking change: consumers must update their imports to use `SqliteDataStore` instead of `SqliteStore`.
