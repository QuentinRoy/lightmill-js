---
'@lightmill/log-server': patch
---

Fix a log being lost when it arrived before logs with lower numbers. For example, sending logs 11 and 33, then 22 and 44, used to erase log 33.
