---
'@lightmill/log-server': patch
---

Fix query parameters being decoded twice, which misread values containing an encoded `&`, `=`, `+`, or `%`: `filter[name]=a%26b` read as `filter[name]=a` and a stray `b` parameter, so filtering on such an experiment name found nothing.
