---
'@lightmill/log-server': patch
---

`POST /runs` and `DELETE /sessions/current` handle one request at a time for each session, so two simultaneous creations can no longer both succeed. `POST /runs` also refuses to create a run while the session has an `idle` run, where it only looked at `running` and `interrupted` runs, and the `403 ONGOING_RUNS` message now says "runs that haven't ended". `PATCH /runs/{id}` no longer answers `403 ONGOING_RUNS` because the session has another ongoing run. When the server cannot save the session during `POST /runs` or `DELETE /sessions/current`, the request now answers `500` instead of success. A custom session store must return what it just saved when the same process reads it back, which the README explains.
