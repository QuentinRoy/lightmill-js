---
'@lightmill/log-server': major
---

`new SQLiteDataStore(path)` is replaced by `await SQLiteDataStore.open(path, options)`. It throws a `DataStoreError` with code `SCHEMA_OUTDATED` when the database has pending migrations, instead of failing on the first query that needs them. Run `await SQLiteDataStore.migrateDatabase(path)` first to create or migrate a database. The `migrateDatabase()` instance method is removed from `SQLiteDataStore` and from the `DataStore` interface: custom implementations no longer need it.
