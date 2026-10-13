---
'@lightmill/react-experiment': major
---

Replace `onTaskCompleted` in what `useTask()` returns with `completeTask(result?)`. The optional `result`, a plain object, goes to the timeline: a generator reads it from the `yield` that produced the task, so an adaptive design such as a staircase no longer needs to keep answers outside the timeline. `yield` returns `undefined` when the task completed without a result, so generators that ignore it are unaffected. To migrate, rename `onTaskCompleted` to `completeTask`, and replace `onClick={onTaskCompleted}` with `onClick={() => completeTask()}`, since an event is not a task result.
