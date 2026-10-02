---
'@lightmill/log-server': major
---

Some requests the server used to accept now fail. `POST /runs` only creates `idle` or `running` runs, and answers `403 INVALID_RUN_STATUS` for any other status. `PATCH /runs/{id}` answers `403 INVALID_LAST_LOG_NUMBER` when `lastLogNumber` comes with a status other than `running`, or without a status on a run that is not running: it used to resume the run if `lastLogNumber` was the run's last log number, even with the status `completed`. A `name` or an `experiment` relationship that differs from the run's answers `403 IMMUTABLE_RUN_ATTRIBUTE`, with a `source.pointer` to the offending attribute, instead of being ignored. Completing an already completed run succeeds even if a log number is missing. Logs are stored only if the run is running when they are written: a run that ended since the request arrived stores none, and `POST /logs` and `POST /operations` answer `403 INVALID_RUN_STATUS` where they could fail with a `500`.

The server, not the database, now enforces these rules, in the same transaction as the writes they guard, so a custom `DataStore` does not have to implement them. Update clients that create completed runs, send a `lastLogNumber` without resuming, or send a different `name` or `experiment` in a `PATCH`.

Upgrading applies a database migration that removes the triggers enforcing the lifecycle and makes run names unique among runs that are not canceled: back up the database, then run `log-server migrate`. It cannot be undone, restore the backup to go back. It stops, and lists the runs, if two runs of an experiment that are not canceled share a name: fix them by hand, then migrate again.
