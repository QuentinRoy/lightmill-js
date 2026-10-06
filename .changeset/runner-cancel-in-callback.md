---
'@lightmill/runner': patch
---

Fix `TimelineRunner#cancel()` being overridden when called from `onTimelineStarted` or `onTaskCompleted`. The runner stays `canceled` and no longer starts the next task.
