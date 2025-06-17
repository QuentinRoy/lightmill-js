---
'@lightmill/log-server': major
---

The `store` option in `LogServer` has been renamed to `dataStore` to reduce confusion with the `sessionStore` option. To update, replace any usage of `store` in the `LogServer` config with `dataStore`.
