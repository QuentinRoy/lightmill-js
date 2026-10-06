---
'@lightmill/log-server': minor
---

Add a `--same-site` option to `log-server start`, so sessions work when the browser loads the page and calls the API from one site over HTTP, even from different ports: a page on `localhost:5173` can call an API on `localhost:3000`. Its cookies are `Secure` over HTTPS only. Behind a reverse proxy that terminates TLS, add `--trust-proxy` so the server sees HTTPS.
