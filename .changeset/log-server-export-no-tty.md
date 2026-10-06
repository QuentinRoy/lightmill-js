---
'@lightmill/log-server': patch
---

Fix `log-server export --output` crashing when the standard output is not a terminal, in a script or CI for example, and reporting one log too many. The progress counter now shows only in a terminal, and the header row is no longer counted as an exported log.
