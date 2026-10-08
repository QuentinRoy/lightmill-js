---
'@lightmill/log-client': patch
---

Fix a failed request throwing an unrelated `TypeError` instead of a `RequestError` when the response body has an empty `errors` array, as a proxy in front of the server can send. The `RequestError` now keeps the response `status` and `headers`, uses the status text as its message, and lists a single error with that status in `errors`.
