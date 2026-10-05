---
'@lightmill/runner': patch
---

Fix `TimelineRunner#cancel()` not stopping a pending async `next()`. A canceled runner no longer starts the task it resolves with, nor reports its rejection through `onError`.
