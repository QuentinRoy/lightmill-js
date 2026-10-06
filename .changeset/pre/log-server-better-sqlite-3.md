---
'@lightmill/log-server': patch
---

pr: #290
commit: 7bb7c48d6a455d3c907b81f7c806b96a8909014f

Fix installing on Node 26, which failed while compiling better-sqlite3 11 from source. The server now uses better-sqlite3 13, which ships prebuilt binaries for current Node versions.
