---
'@lightmill/log-server': major
---

Rename `LogServer` to `createLogServer`. It is a plain function, not a class, so the capital letter suggested `new`. Replace `LogServer(options)` with `createLogServer(options)` and update the import.
