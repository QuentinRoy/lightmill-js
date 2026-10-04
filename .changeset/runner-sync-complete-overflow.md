---
'@lightmill/runner': patch
---

Fix `completeTask()` called from `onTaskStarted` overflowing the stack on long synchronous timelines (around 3,000 tasks). The next task now starts once `onTaskStarted` returns, so code after `completeTask()` in `onTaskStarted` runs before the next task starts instead of after the rest of the timeline. Calling `completeTask()` twice from the same `onTaskStarted` now throws instead of completing the next task, and a throwing `onTaskStarted` now sets the runner's status to `crashed`.
