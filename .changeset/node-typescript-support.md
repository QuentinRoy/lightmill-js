---
'@lightmill/log-server': major
'@lightmill/convert-touchstone': major
---

Require Node 26 or later. Older Node versions are no longer supported.

`@lightmill/log-server` now uses better-sqlite3 13, which ships prebuilt binaries for current Node versions. Installing on Node 26 used to fail while compiling better-sqlite3 11 from source.
