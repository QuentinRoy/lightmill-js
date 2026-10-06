---
'@lightmill/log-server': minor
---

Participants can now resume runs after restarting `log-server start`, as long as they return with the same browser session. Browser sessions last 30 days by default; use `--session-max-age-days` to change that. The new `sessionMaxAge` option of `createLogServer` sets the session cookie's lifetime in milliseconds.
