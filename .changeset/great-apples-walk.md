---
'@lightmill/log-api': major
---

The `name` attribute of the `run` resource is now mandatory. To improve consistency and avoid ambiguity, runs without a name must now explicitly set `name: null` instead of omitting the field.
