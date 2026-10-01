---
'@lightmill/react-experiment': minor
---

`Run` no longer replaces the running task with `elements.loading` when `loading` turns `true`. Like `paused`, it keeps rendering the task, then renders `elements.loading` instead of what comes next, including `elements.completed`. If `loading` goes back to `false` before the task ends, nothing changes on screen: the task keeps its state and timers. When `loading` and `paused` are both `true`, `elements.paused` wins.
