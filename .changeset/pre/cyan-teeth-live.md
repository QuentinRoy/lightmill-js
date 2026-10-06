---
'@lightmill/log-api': major
---

Replace the `openapi.json` export with `openapi.yaml`, the format most OpenAPI tools expect, and stop exporting the TypeScript types generated from the OpenAPI document. Import `@lightmill/log-api/openapi.yaml` with a YAML parser instead of `openapi.json`. For types, infer them from the exported zod schemas, or generate them from `openapi.yaml` with `openapi-typescript`.
