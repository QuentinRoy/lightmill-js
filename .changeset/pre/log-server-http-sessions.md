---
'@lightmill/log-server': minor
---

Add a `--same-origin` option to the `log-server start` command so sessions
work when the browser loads the page and calls the API from one HTTP origin.
Rule out cookie settings that browsers reject, and document when HTTPS is
required.
