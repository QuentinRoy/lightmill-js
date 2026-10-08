---
'@lightmill/log-client': patch
---

Give `RequestError` the message `HTTP <status>` when the response has neither a body nor a status text, as with HTTP/2 responses, instead of an empty message.
