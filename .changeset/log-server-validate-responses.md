---
'@lightmill/log-server': minor
---

Add the `validateResponses` option to `createLogServer`, off by default. When on, a response that does not match the API schemas answers `500`, which helps tests catch server bugs. When off, the server no longer takes an endpoint down over stored data the schemas do not expect: `GET /experiments` used to answer `500` to everyone once an experiment had an empty name.
