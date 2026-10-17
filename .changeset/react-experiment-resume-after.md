---
'@lightmill/react-experiment': minor
---

Export `resumeAfter` from `@lightmill/react-experiment`. It wraps a timeline so that it starts after the last completed task. Deprecate the `resumeAfterTask` prop of `TimelinePlayer` in favor of it; the prop still works. To migrate, replace `<TimelinePlayer timeline={tasks} resumeAfterTask={(task) => task.id === lastLog.taskId} />` with `<TimelinePlayer timeline={resumeAfter(tasks, (task) => task.id === lastLog.taskId)} />`. `TimelinePlayer` throws if its timeline changes, so create the resumed timeline once. The predicate must be pure.
