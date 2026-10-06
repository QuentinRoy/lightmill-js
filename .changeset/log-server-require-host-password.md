---
'@lightmill/log-server': major
---

`createLogServer` requires a `hostPassword` option, and `log-server start` requires `--host-password` or the `HOST_PASSWORD` environment variable. Without one, anyone could open a host session, read every experiment, run and log, create experiments and cancel any run. `createLogServer` throws a `TypeError` if the password is missing or empty, and `log-server start` exits with an error. Pass a non-empty password to both.
