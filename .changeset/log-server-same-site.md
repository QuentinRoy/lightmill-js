---
'@lightmill/log-server': major
---

Rename the `allowCrossOrigin` option of `createLogServer` to `cookieSite`: replace `allowCrossOrigin: false` with `cookieSite: 'same-site'`, and `true` (the default) with `'cross-site'`. The old name suggested the page had to share the API's origin, but cookies only need the same site. `secureCookies` takes `'auto'`, `'always'` or `'never'` instead of a boolean: replace `true` with `'always'` and `false` with `'never'`. Same-site cookies now default to `'auto'`, `Secure` over HTTPS and not over HTTP, where `allowCrossOrigin: false` used to make them never `Secure`; behind a reverse proxy that terminates TLS, set `trustProxy` so the server sees HTTPS. To keep the old behavior, pass `secureCookies: 'never'`. Cross-site cookies, which browsers reject without `Secure`, only accept `'always'`.
