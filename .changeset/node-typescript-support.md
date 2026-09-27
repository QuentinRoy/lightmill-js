---
'@lightmill/log-server': major
'@lightmill/convert-touchstone': major
---

Require Node 22.18 or later on Node 22, or Node 24.3 or later. Node 22.0 to 22.17, Node 23, and Node 24.0 to 24.2 are no longer supported.

`@lightmill/log-server` now uses better-sqlite3 13, which ships prebuilt binaries for current Node versions, including Node 26. Installing on Node 26 used to fail while compiling better-sqlite3 11 from source.
