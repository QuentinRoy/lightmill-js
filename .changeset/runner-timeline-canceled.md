---
'@lightmill/runner': patch
---

Fix `TimelineRunner#cancel()` never calling `onTimelineCanceled`. It now calls it once, after the status changes to `canceled`.
