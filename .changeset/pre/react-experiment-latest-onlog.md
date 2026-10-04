---
'@lightmill/react-experiment': patch
---

Fix `Run` ignoring changes to `onLog`: logs went to the `onLog` it first rendered with, so a `Run` first rendered with `loading` and no `onLog` threw as soon as a task logged, even once it had one. Logs now go to the current `onLog`.
