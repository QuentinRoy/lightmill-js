---
'@lightmill/log-api': patch
---

Fix the OpenAPI document listing `null` twice in the `anyOf` of the nullable run `name` and `firstMissingLogNumber`. The zod schemas it exports (`routes` and the server errors) are now built with zod 4.6, instead of the zod 4 build bundled with zod 3.25.
