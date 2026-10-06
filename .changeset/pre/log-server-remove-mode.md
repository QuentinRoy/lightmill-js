---
'@lightmill/log-server': major
---

pr: #424
commit: b4287327e077a05a329d8207d84dc946474d1b4c

`createLogServer` no longer takes a `mode` option and no longer validates its responses. With a `mode` other than `production` (the default came from `NODE_ENV`), the server checked each response against the API schema and answered `500 INTERNAL_SERVER_ERROR` to any it rejected, so stored data the schema did not expect, such as an experiment with an empty name, broke every request that read it. Remove `mode` from your options.
