---
"@lightmill/log-server": minor
---

Participants can now resume runs after restarting `log-server start`, as long
as they return with the same browser session. Browser sessions can last up to
30 days by default; use `--session-max-age-days` to change that period.
