---
'@lightmill/log-server': major
---

`LogServer` no longer takes a `mode` option. It only turned off response validation when set to `test` (the default came from `NODE_ENV`), which let tests pass on responses that failed in production. Responses are now validated in every mode. Remove `mode` from your `LogServer` options.
