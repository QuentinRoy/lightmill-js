---
'@lightmill/convert-touchstone': patch
---

Fix the `DesignConfig` type importing `@lightmill/static-design`, which is not a dependency of `@lightmill/convert-touchstone`, so `convertTouchstone`'s result lost its type unless `@lightmill/static-design` was installed. `DesignConfig` now declares its `runs` itself.
