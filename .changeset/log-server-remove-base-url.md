---
'@lightmill/log-server': major
---

Remove the `baseUrl` option of `createLogServer`. It did nothing: the server reads the path it is mounted on from Express. Remove `baseUrl` from your `createLogServer` options. If a proxy strips a path prefix before forwarding, have it send `X-Forwarded-Prefix`.
