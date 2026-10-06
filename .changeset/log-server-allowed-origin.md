---
'@lightmill/log-server': minor
---

`log-server start` takes `--allowed-origin <origin>` (repeatable) or the `ALLOWED_ORIGINS` environment variable (comma-separated) to name the pages on other origins that may call it, and answers those origins, and no others, with credentials allowed, so `@lightmill/log-client` can send its session cookie. It exits with an error unless `--allowed-origin` or `--same-origin` is set. For development over HTTP, the two work together: `log-server start --same-origin --allowed-origin http://localhost:5173 --host-password <password>`. `createLogServer` sets no CORS headers: put `cors({ origin: [...], credentials: true, exposedHeaders: ['Retry-After'] })` in front of it for pages on another origin.
