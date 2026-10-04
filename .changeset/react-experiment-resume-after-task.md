---
'@lightmill/react-experiment': major
---

Replace the `resumeAfter` prop of `Run` with `resumeAfterTask`, a function that receives each task and returns `true` for the last completed one. `Run` skips every task up to and including the first match, and throws if no task matches. `resumeAfter: { type, number }` counted tasks of one type, which `@lightmill/log-client` no longer provides: `getResumableRuns` returns a run-wide log number. `resumeAfter` also mishandled `number: 0`, skipping the first task or throwing. To migrate, store something that identifies the task in its logs and match on it: `resumeAfter={{ type: 'trial', number: n }}` becomes `resumeAfterTask={(task) => task.type === 'trial' && task.trialNumber === n}`. Omit the prop when no task was completed.
