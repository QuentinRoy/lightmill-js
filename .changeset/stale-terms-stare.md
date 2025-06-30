---
"@lightmill/log-client": minor
---

`Logger#flush` now checks for missing logs on the server and fails if any are missing that were added prior to the flush call. This is considered a minor change, as it primarily surfaces existing issues (such as communication errors) earlier.
