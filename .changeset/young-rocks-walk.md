---
'@lightmill/log-server': major
---

`GET /logs` handler now defaults to CSV format and only returns JSON when the Accept header is set to JSON. This change allows logs to be downloadable from HTML without requiring JavaScript to set the `Accept` header.