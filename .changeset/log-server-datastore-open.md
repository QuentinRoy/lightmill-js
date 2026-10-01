---
'@lightmill/log-server': major
---

`new SQLiteDataStore(path)` is replaced by `await SQLiteDataStore.open(path, options)`. By default it throws a `DataStoreError` with code `SCHEMA_OUTDATED` when the database has pending migrations, instead of failing on the first query that needs them. Pass `schema: 'migrate'` to apply the migrations, or `schema: 'skip'` to skip the check.
