---
'@lightmill/log-client': patch
---

`@lightmill/log-client` depends on `@lightmill/log-api` at runtime, so installing it also installs zod and zod-to-openapi. It imports only `@lightmill/log-api/vocabulary`, so bundles do not grow.
