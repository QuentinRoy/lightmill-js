---
'@lightmill/convert-touchstone': patch
---

Fix `convertTouchstone` throwing `sax.parser is not a function` or `sax.createStream is not a function` when the package runs in Node.
