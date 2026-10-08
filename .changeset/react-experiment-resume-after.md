---
'@lightmill/react-experiment': minor
---

Add `resumeAfter`, exported by `@lightmill/react-experiment` and `@lightmill/runner`, to wrap a timeline so it starts after the last completed task. Deprecate the `resumeAfterTask` prop of `TimelinePlayer` in its favor: one resume API is easier to use than a prop on the player and a helper for runners. The prop still works, but will be removed in a future major version. To migrate, wrap the timeline with `resumeAfter` and drop the prop: `<TimelinePlayer timeline={tasks} resumeAfterTask={(task) => task.id === lastLog.taskId} />` becomes `<TimelinePlayer timeline={resumeAfter(tasks, (task) => task.id === lastLog.taskId)} />`. Create the resumed timeline once, like any other timeline: `TimelinePlayer` throws if its timeline changes. The predicate must be pure.
