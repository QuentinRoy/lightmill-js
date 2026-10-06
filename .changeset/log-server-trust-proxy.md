---
'@lightmill/log-server': minor
---

Add a `--trust-proxy` option to `log-server start` and document `trustProxy`. `createLogServer` no longer trusts `X-Forwarded-*` headers by default, so a client reaching the server directly cannot forge them. A server behind a TLS-terminating proxy needs `trustProxy` (or `--trust-proxy`) to send `Secure` session cookies.
