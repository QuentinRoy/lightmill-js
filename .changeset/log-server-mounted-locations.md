---
'@lightmill/log-server': patch
---

Fix the `Location` header of `POST /sessions`, `/experiments`, `/runs` and `/logs` leaving out the path the server is mounted on: mounted with `app.use('/api', middleware)`, creating a session answered `http://host/sessions/current` instead of `http://host/api/sessions/current`. The path now includes nested mounts and the `X-Forwarded-Prefix` header of a trusted proxy, like it already does for `X-Forwarded-Host` and `X-Forwarded-Proto`.
