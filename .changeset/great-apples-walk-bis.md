---
"@lightmill/log-server": major
---

Parameters passed to `addRun` may now explicitly specify `runName: null` to indicate that the run has no name. Omitting the `runName` parameter is still allowed—it will default to `null` if not provided. However, the promises returned by `addRun` and `getRuns` must now always include `runName: null` for unnamed runs, rather than using `undefined` or omitting the field. This improves consistency with the JSON API, where unnamed runs are represented with `name: null`.
