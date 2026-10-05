---
'@lightmill/log-api': patch
---

Fix the OpenAPI document listing `null` twice in the `anyOf` of the nullable run `name` and `firstMissingLogNumber`. The zod schemas it exports (`routes` and the server errors) now come from zod 4.6.
