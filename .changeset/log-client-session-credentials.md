---
'@lightmill/log-client': patch
---

Fix `Client#startRun()` omitting credentials from the experiment lookup, the run lookup by name, and the session creation, so a cross-origin server neither received nor set the session cookie. `startRun()` now rejects with a `RequestError` when the server refuses to create the session, instead of carrying on without one.
