---
'@lightmill/log-server': major
---

Remove the `baseUrl` option of `createLogServer`. The server now reads the path it is mounted on from Express, nested mounts included, and from the `X-Forwarded-Prefix` header of a trusted proxy, like it does for `X-Forwarded-Host` and `X-Forwarded-Proto`. This fixes the `Location` header of `POST /sessions`, `/experiments`, `/runs`, and `/logs`, which left out the mount path: mounted with `app.use('/api', middleware)`, creating a session answered `http://host/sessions/current` instead of `http://host/api/sessions/current`. Remove `baseUrl` from your options. If a proxy strips a path prefix before forwarding, have it send `X-Forwarded-Prefix`.
