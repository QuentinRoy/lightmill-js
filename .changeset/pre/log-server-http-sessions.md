---
'@lightmill/log-server': minor
---

Add a `--same-origin` option to `log-server start`, so sessions work when the browser loads the page and calls the API from one HTTP origin. `createLogServer` no longer accepts `secureCookies: false` with cross-origin cookies, which browsers reject: set `allowCrossOrigin: false` too.
