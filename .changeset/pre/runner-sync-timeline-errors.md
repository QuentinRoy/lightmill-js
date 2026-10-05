---
'@lightmill/runner': patch
---

Fix errors thrown by a sync timeline bypassing `onError`. They escaped from `start()` or `completeTask()` and left the runner `running`. They now go to `onError` and set the status to `crashed`, like errors from async timelines, and are still thrown when there is no `onError`.
