---
'@lightmill/log-server': patch
---

`POST /runs` and `DELETE /sessions/current` handle one request at a time for each session, so two simultaneous creations can no longer both succeed. When the server cannot save the session during one of them, the request now answers `500` instead of success. A custom session store must return what it just saved when the same process reads it back, which the README explains.
