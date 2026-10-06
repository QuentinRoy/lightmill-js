---
'@lightmill/runner': minor
---

`TimelineRunner` and `runTimeline` accept a timeline iterator whose `next()` returns a promise on some calls only, such as one that turns async partway through. The new `MaybeAsyncIterator` type describes it.
