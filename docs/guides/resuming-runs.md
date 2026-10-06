# Resuming runs

Participants reload pages, close tabs by mistake, and lose their connection. Resuming lets them come back to their run and continue after their saved progress. The [getting started](getting-started.md) app resumes runs; this guide explains how it works and what it needs.

## How it works

The server stores every log of a run with a number: 1, 2, 3, and so on. Some log types mark the end of a task: these are the resumable log types. To resume, the app asks the server for the run's last log of one of these types, tells the server to resume after it, and skips every task of the timeline up to the one the log names.

The last log ignores stranded logs. When a log number is missing, for example because its request failed while later ones arrived, the logs above it are stranded: the server keeps them, but they don't count until every missing log before them arrives.

Resuming cancels the logs that come after the resume point. The server keeps them, but they no longer count toward the run, and exports leave them out. New logs continue the numbering from the resume point.

## What the app needs

1. **Log the end of each task.** Log once when each task completes, with the task's id. The types of these logs are the resumable log types. A task that also logs while it runs, such as every mouse move, starts over on resume, and its earlier logs are canceled.

   ```ts
   log({ taskId: task.id, size: task.size, reactionTime });
   onTaskCompleted();
   ```

2. **Find the run.** `getResumableRuns` lists the runs this browser started that are running or interrupted. Filter by experiment and run name:

   ```ts
   const [resumable] = await client.getResumableRuns({
     experimentName,
     runName,
     resumableLogTypes: ['intro', 'trial'],
   });
   ```

   Each result has the run, its experiment, and `toResumeAfter`: the number of the last resumable log and the log itself, with its values. When the run has no resumable log yet, `toResumeAfter` is `{ number: 0, log: null }`.

3. **Resume the run.** Pass `toResumeAfter` to `startRun` as is:

   ```ts
   const logger = await client.startRun({
     runId: resumable.run.id,
     after: resumable.toResumeAfter,
   });
   ```

   With `{ number: 0 }`, the run starts over from the beginning, and every log it had is canceled.

4. **Skip the tasks already done.** Give `TimelinePlayer` a `resumeAfterTask` function that returns `true` for the last completed task:

   ```tsx
   <TimelinePlayer
     timeline={timeline}
     resumeAfterTask={
       lastTaskId == null ? undefined : (task) => task.id === lastTaskId
     }
     // ...
   />
   ```

   `TimelinePlayer` starts with the task after the first one that matches. It throws when no task matches, which usually means the timeline changed.

5. **Rebuild the same timeline.** For a fixed design, build the timeline from a stable input, such as the participant number, so the saved task id is still in it and the remaining tasks keep their order. If task order uses randomness, use a random number generator seeded with the participant number rather than `Math.random`.

## Avoid losing progress

Resuming recovers a run, but the logs that hadn't reached the server are lost, and the participant repeats their tasks. So ask the browser to confirm before the page closes or reloads, from the start of the run until it ends: a reload is risky whenever logs are on their way, not only when saving fails.

With React, use `useConfirmBeforeUnload` from `@lightmill/react-experiment`, as the [getting started app](getting-started.md#show-errors-and-confirm-before-leaving) does. Without React, listen to `beforeunload`:

```ts
function confirmBeforeUnload(event: BeforeUnloadEvent) {
  event.preventDefault();
  event.returnValue = '';
}
addEventListener('beforeunload', confirmBeforeUnload);

// Once the run has ended:
removeEventListener('beforeunload', confirmBeforeUnload);
```

The confirmation saves nothing, and browsers don't always show it: they skip it until the participant has interacted with the page, and some mobile browsers never show it. It makes accidental reloads rarer, not impossible.

## What the server needs

The server finds a participant's runs through their session, so sessions must outlive the interruption:

- The standalone `log-server start` command stores sessions in its database, so they survive restarts. Sessions last 30 days; change it with `--session-max-age-days`.
- A server built with `createLogServer` keeps sessions in memory by default, and loses them on restart. Pass a persistent `sessionStore`, such as `dataStore.getSessionStore()`, and set `sessionMaxAge`. See [`@lightmill/log-server`](../../packages/log-server/README.md#resuming-runs-after-a-restart).
- Keep the session key stable. See [Deploying](deploying.md#secrets).

## Limits

- **Logs that haven't reached the server are lost when the page closes.** The participant then resumes after the last log the server has, and repeats the tasks after it. See [Avoid losing progress](#avoid-losing-progress).
- **Runs resume in the same browser only.** The session lives in a cookie. A participant who switches browser or device, or clears their cookies, can't find their run. Starting a new run with the same name then fails with a `RUN_EXISTS` error, because the old run still owns that name. Names are unique among runs that are not canceled in the same experiment. A host can free the name by [canceling the old run](deploying.md#cancel-a-run), which also leaves its logs out of the CSV export.
- **Completed runs can't resume.** A participant who opens the experiment again after completing it gets the same `RUN_EXISTS` error. Show them a message rather than an error.
- **Interruptions go unnoticed.** When a participant closes the tab, the run stays `running` until they come back. Hosts see it as running.

## Without React

Steps 1 to 3 and 5 are the same. Instead of `resumeAfterTask`, skip the tasks yourself: drop every task up to and including the last one logged before you give the timeline to `@lightmill/runner`.

```ts
let start = 0;
if (lastTaskId != null) {
  const index = timeline.findIndex((task) => task.id === lastTaskId);
  if (index === -1) {
    throw new Error(`Saved task ${lastTaskId} is missing from the timeline`);
  }
  start = index + 1;
}
await runTimeline({ timeline: timeline.slice(start), runTask });
```

With no saved task id, the whole timeline runs. If a saved id is missing from the timeline, stop and investigate the changed design instead of silently repeating every task.
