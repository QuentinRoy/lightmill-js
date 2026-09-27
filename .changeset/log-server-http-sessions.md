---
'@lightmill/log-server': minor
---

Add a `--same-origin` option to the `log-server start` command so sessions
work when a page and the API share an origin over HTTP. Rule out cookie
settings that browsers reject, and document when HTTPS is required.
