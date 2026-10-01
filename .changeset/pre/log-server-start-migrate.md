---
'@lightmill/log-server': major
---

`log-server start` and `log-server export` no longer create the database. They exit with an error when the database is missing or has pending migrations, instead of running on an outdated schema. Back up the database, then run `log-server migrate` first.
