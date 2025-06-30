---
"@lightmill/log-client": major
---

`Logger#flush` now only waits for logs that were added before it was called. This allows users to continue adding logs while waiting for the flush to resolve, and makes its behavior more deterministic when logs are added continuously.