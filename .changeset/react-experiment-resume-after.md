---
'@lightmill/react-experiment': major
---

Replace the `resumeAfterTask` prop of `TimelinePlayer` with `resumeAfter`, a function exported by `@lightmill/react-experiment` and `@lightmill/runner` that wraps a timeline. One resume API is easier to use than a prop on the player and a helper for runners. To migrate, wrap the timeline with `resumeAfter` and drop the prop: `<TimelinePlayer timeline={tasks} resumeAfterTask={(task) => task.id === lastLog.taskId} />` becomes `<TimelinePlayer timeline={resumeAfter(tasks, (task) => task.id === lastLog.taskId)} />`. Create the resumed timeline once, like any other timeline: `TimelinePlayer` throws if its timeline changes. The predicate must be pure, and the error thrown when no task matches now reads `No task matched the resumeAfter predicate`.
