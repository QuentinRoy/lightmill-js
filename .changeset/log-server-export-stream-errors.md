---
'@lightmill/log-server': patch
---

Fix `log-server export` crashing with an uncaught exception when reading the database fails midway. The error is now reported, and `--output` no longer leaves a truncated file: the export is written to a temporary file and moved into place only once complete.
