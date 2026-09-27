---
'@lightmill/log-server': major
---

commit: 7bb7c48d6a455d3c907b81f7c806b96a8909014f
pr: 290

Switch to better-sqlite3 13, which ships prebuilt binaries for current Node versions, including Node 26. Installing on Node 26 used to fail while compiling better-sqlite3 11 from source.
