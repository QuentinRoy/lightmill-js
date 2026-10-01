---
'@lightmill/log-server': major
---

`new SQLiteDataStore(path)` can no longer be called: use `await SQLiteDataStore.open(path, options)`. It throws a `DataStoreError` with code `SCHEMA_OUTDATED` when the database has pending migrations, instead of failing on the first query that needs them, and throws when the file does not exist instead of creating it. To create or migrate a database, run `await SQLiteDataStore.migrateDatabase(path)` first. As an exception, an in-memory database (`':memory:'`) is migrated automatically. The `migrateDatabase()` instance method is removed from `SQLiteDataStore` and from the `DataStore` interface: custom implementations no longer need it. `DataStoreError` is now exported, so embedders can catch it.
