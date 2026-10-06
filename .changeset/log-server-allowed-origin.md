---
'@lightmill/log-server': major
---

Fix `log-server start` blocking browser pages on another origin. It answered `Access-Control-Allow-Origin: *` without allowing credentials, so browsers refused every request of `@lightmill/log-client`, which sends the session cookie. `start` now takes `--allowed-origin <origin>` (repeatable) or the `ALLOWED_ORIGINS` environment variable (comma-separated), and answers those origins, and no others, with credentials allowed. It also exits with an error when neither this nor `--same-origin` is set, so add `--allowed-origin` to your command, or `--same-origin` if the browser loads the page from the same site as the API. For development over HTTP, `--same-origin` and `--allowed-origin` work together: `log-server start --same-origin --allowed-origin http://localhost:5173`. `createLogServer` still sets no CORS headers: put `cors({ origin: [...], credentials: true, exposedHeaders: ['Retry-After'] })` in front of it for pages on another origin.
