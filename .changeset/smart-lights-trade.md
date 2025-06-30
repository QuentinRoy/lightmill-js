---
"@lightmill/log-server": patch
---

The `GET /logs` endpoint no longer fails when the `Accept` header is unrecognized. It now defaults to returning CSV format in such cases.