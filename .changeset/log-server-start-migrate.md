---
'@lightmill/log-server': major
---

`log-server start` no longer creates the database. It exits with an error when the database is missing or has pending migrations, instead of running on an outdated schema. Back up the database, then run `log-server migrate` first.
