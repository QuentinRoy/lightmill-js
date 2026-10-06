---
'@lightmill/log-server': minor
---

`log-server start` takes `--secure-cookies <auto|always|never>`, the counterpart of the `secureCookies` option of `createLogServer`. With `--same-site`, it defaults to `auto`; use `always` behind a proxy that does not set `X-Forwarded-Proto`, or `never` to drop `Secure`. Without `--same-site`, cookies stay `Secure`, and `auto` and `never` are rejected. A repeated `--secure-cookies` takes its last value.
