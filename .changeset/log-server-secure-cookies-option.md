---
'@lightmill/log-server': minor
---

`log-server start` takes `--secure-cookies <auto|always|never>`, the counterpart of the `secureCookies` option of `createLogServer`. With `--same-site`, it defaults to `auto`; use `always` to require HTTPS, or `never` to drop `Secure`. Behind a proxy that handles HTTPS, both `auto` and `always` need `--trust-proxy` and `X-Forwarded-Proto: https`; `always` does not set a cookie when the server cannot recognize HTTPS. Without `--same-site`, cookies stay `Secure`, and `auto` and `never` are rejected. A repeated `--secure-cookies` takes its last value.
