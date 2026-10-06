---
'@lightmill/log-server': patch
---

Fix `lightmill-log-server experiment add` accepting an empty experiment name, which made `GET /experiments` fail response validation. It now exits with an error.
