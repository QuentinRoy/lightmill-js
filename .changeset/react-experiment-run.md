---
'@lightmill/react-experiment': minor
---

Add `Run`, which starts or resumes a run, plays its timeline, sends the logs from `useLogger` to the server and completes the run once every log is stored. Pass it a `@lightmill/log-client` client, `experimentName`, `runName`, `resumableLogTypes`, a `timeline` builder (`({ resumeLog }) => Timeline`, or `null` while the app loads it) and the task components in `elements.tasks`. The builder runs once per run, with the last log whose type is in `resumableLogTypes`, or `null` for a new run. React Strict Mode and remounts neither start nor resume a run twice, and changing `client`, `experimentName` or `runName` selects another run. `@lightmill/react-experiment` does not import `@lightmill/log-client` at runtime.

When a run with the same experiment and run names is ongoing, `Run` asks before resuming it. `useResumeRun()` returns `{ resume, run, lastLog }` for a custom `elements.resume`.

While logs cannot be delivered, `Run` shows `elements.paused`, whose default has a retry button and a link to download the logs that were not saved. `useLogDelivery()` returns `{ error, inFlightLogs, retry }` for a custom screen. It works in every element of `Run`, including `elements.loading`, `elements.resume` and `elements.error`. `retry` never rejects.

When the run cannot start or crashes (a task error, a throwing builder, a rejected `addLog` or `completeRun`, or a run that is interrupted or canceled after the timeline completed), `Run` shows `elements.error`. `useRunError()` returns the thrown value unchanged as `{ error }`. The slot renders outside `Run`'s own error boundary, so what it throws reaches the app's. The default tells the participant to contact the experimenter, explains `RUN_EXISTS` and `ONGOING_RUNS`, and has a collapsed block of details, the download link while logs are held and a retry button while delivery is paused.

After a crash, `Run` interrupts the run once every log is stored, retrying a failed interrupt, so a reload lands on the resume prompt. An interrupt failure is logged and does not replace the error. The browser asks for confirmation before the page unloads until the run ends, and while the error slot shows held logs.

`elements.loading`, `elements.resume`, `elements.paused`, `elements.error` and `elements.completed` have defaults.

The default `AnyLog` type, used when no log type is registered with `RegisterExperiment`, now has a string index signature instead of `PropertyKey`.
