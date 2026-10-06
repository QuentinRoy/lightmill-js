---
'@lightmill/log-server': major
---

`createLogServer` requires a `hostPassword` option, and `log-server start` requires `--host-password` or the `HOST_PASSWORD` environment variable. Without a password, anyone could open a host session and read every experiment, run and log, including the CSV export, create experiments and cancel any run. `createLogServer` throws a `TypeError` if `hostPassword` is missing or empty, and `log-server start` exits with an error. Pass a password to both. Clients create a host session by authenticating with HTTP Basic authentication as `hostUser` (`host` by default) and that password.
