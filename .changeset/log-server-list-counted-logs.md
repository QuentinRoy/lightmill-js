---
'@lightmill/log-server': patch
---

Fix `GET /logs` and `getLogs` listing stranded logs, the logs above a run's first missing log number, which `lastLogs` and `lastLogNumber` leave out. The listing and the CSV export now return only the logs a run counts. A stranded log appears once the missing log arrives, so a listing of a run still in progress can gain rows.
