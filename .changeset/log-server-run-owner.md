---
'@lightmill/log-server': major
---

Only the session that created a run can add logs to it or change it, so two clients can no longer write to the same run. A host session used to write to any run: `POST /logs`, `POST /operations` and `PATCH /runs/{id}` now answer `403 RUN_NOT_OWNED` when it writes to a run another session created. A host can still read every run, and cancel any run with `PATCH /runs/{id}`. Write to a run from the session that created it.
