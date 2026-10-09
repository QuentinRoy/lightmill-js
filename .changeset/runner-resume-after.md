---
'@lightmill/runner': minor
---

Add `resumeAfter(timeline, predicate)`, which returns a timeline starting after the first task `predicate` matches, such as the last task a run completed. It stays synchronous for a synchronous timeline, and its first `next()` call throws if no task matches. `predicate` must be pure, since the timeline is replayed up to the matching task.
