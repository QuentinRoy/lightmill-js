---
'@lightmill/convert-touchstone': patch
---

Fix `convertTouchstone` failing on a streamed Touchstone file with `XML declaration encoding ISO-8859-1 does not match detected stream encoding UTF8`, which happened as soon as `sax` 1.6 was installed. It now requires `sax` 1.5.
