---
'@lightmill/runner': minor
---

Add `resumeAfter(timeline, predicate)`, which returns a timeline starting after the first task `predicate` matches, such as the last task a run completed. It stays synchronous for a synchronous timeline, and its first `next()` call throws if no task matches. `predicate` must be pure, since the timeline is replayed up to the matching task. Once resumed, it passes task results on to the timeline. Also add `toIterator(timeline)`, which returns the iterator a runner reads from a timeline: its own iterator, or the timeline itself if it is an iterator.
