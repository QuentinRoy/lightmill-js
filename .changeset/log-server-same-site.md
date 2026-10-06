---
'@lightmill/log-server': major
---

Rename `log-server start --same-origin` to `--same-site`, and the `allowCrossOrigin` option of `createLogServer` to `cookieSite`: `allowCrossOrigin: false` becomes `cookieSite: 'same-site'`, and `true` becomes `'cross-site'` (the default). The old names suggested the page had to share the API's origin, but cookies only need the same site, so a page on `localhost:5173` can call an API on `localhost:3000`. Same-site cookies are now `Secure` over HTTPS and not over HTTP, where they used to never be `Secure`. Behind a reverse proxy that terminates TLS, set `trustProxy` (`--trust-proxy`) so the server sees HTTPS. `secureCookies` accepts `true`, `false` or `'auto'` (the same-site default) with `cookieSite: 'same-site'`, and only `true` with `'cross-site'`.
