---
'@lightmill/log-server': minor
---

Add the `trustProxy` option of `createLogServer` and the `--trust-proxy` option of `log-server start`, off by default, to trust the `X-Forwarded-*` headers of a reverse proxy. A server behind a TLS-terminating proxy needs it to send `Secure` session cookies. Enable it only behind a proxy that sets these headers, since a client reaching the server directly could forge them.
