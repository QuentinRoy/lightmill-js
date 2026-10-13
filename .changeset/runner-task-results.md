---
'@lightmill/runner': minor
---

Pass task results to the timeline: `TimelineRunner`'s `completeTask(result)` and what `runTimeline`'s `runTask` resolves with go to the timeline's `next()`, so a generator reads them from `yield`. `TimelineRunner`, `runTimeline`, `SuperIterator` and `MaybeAsyncIterator` take the result type as a second type parameter, `unknown` by default.
