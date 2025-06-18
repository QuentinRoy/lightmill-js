---
"@lightmill/log-client": major
---

Include `name: null` as a run attribute in the POST request when creating a run without a name, to comply with changes in `@lightmill/log-api` that require unnamed runs to explicitly specify `null` for `name`.
