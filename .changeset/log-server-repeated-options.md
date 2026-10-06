---
'@lightmill/log-server': patch
---

A repeated scalar option of `log-server` (`--port`, `--database`, `--session-key`, and the like) takes its last value instead of crashing. `--allowed-origin` still collects every origin.
