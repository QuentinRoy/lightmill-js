---
'@lightmill/log-api': major
---

Removes typescript-openapi type export. The prefered way to rely on our contract's type is now to use the zod schemas directly. openapi.yaml is still being generated so typescript-openapi types can be generated from it if needed.
