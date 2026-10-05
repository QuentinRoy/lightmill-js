---
'@lightmill/log-server': patch
---

Fix the CSV export of `GET /logs` writing values that contain a carriage return without quotes, which CSV readers can take for the end of a row. Such values are now quoted.
