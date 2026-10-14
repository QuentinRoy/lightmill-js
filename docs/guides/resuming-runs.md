# Resuming runs

Participants reload pages, close tabs by mistake, and lose their connection. Resuming lets them come back to their run and continue after their saved progress. The [getting started](getting-started.md) app resumes runs; this guide explains how it works and what it needs. With React, `Run` does the work: the steps below say what it needs from your app. The [Without React](#without-react) section shows the same steps one by one.

## How it works

The server stores every log of a run with a number: 1, 2, 3, and so on. Each completed task writes a completion log, which holds the task's id and its result. To resume, the app asks the server for the run's last completion log, tells the server to resume after it, and plays the timeline again from that point.

The last log ignores stranded logs. When a log number is missing, for example because its request failed while later ones arrived, the logs above it are stranded: the server keeps them, but they don't count until every missing log before them arrives.

Resuming cancels the logs that come after the resume point. The server keeps them, but they no longer count toward the run, and exports leave them out. New logs continue the numbering from the resume point.

## What the app needs

1. **Complete each task with its result.** When a task calls `completeTask(result)`, `Run` writes its completion log: a log with the task's type, the task's id in `taskId`, and the result as its values. The result also goes to the timeline: a generator reads it from the `yield` that produced the task.

   ```ts
   completeTask({ size: task.size, reactionTime });
   ```

   A task that also logs while it runs, such as every mouse move, starts over on resume, and its earlier logs are canceled. Keep results small, and put bulk data in logs of other types: resuming reads every completion log back from the server.

2. **Give every task an id**, unique within the run. Replay matches tasks to completion logs by id.

3. **Pass the same timeline.** `Run` looks for a run of the same experiment and run name that this browser started and left running or interrupted. When it finds one, it asks the participant to resume. It then reads all of the run's completion logs and replays your timeline: it asks the timeline for each task, checks that it has the id and type of the next completion log, and passes that log's values back as the task result, as `completeTask` did. No task renders during the replay, so a staircase or any other generator that adapts to the results gets back to where the participant stopped. Then the run continues with the task the participant had not completed.

   ```tsx
   import { Run } from '@lightmill/react-experiment';

   <Run
     client={client}
     experimentName="reaction-time"
     runName={`participant-${participant}`}
     timeline={createTimeline(participant)}
     elements={elements}
   />;
   ```

   Pass `null` as `timeline` while your app loads what it needs to build one: `Run` waits for it. `elements.loading` shows while `Run` reads the logs and replays.

   When no task was completed yet (resume number 0), the run starts over from the beginning, and every log it had is canceled.

4. **Rebuild the same timeline.** Build the timeline from a stable input, such as the participant number, so it yields the same tasks in the same order. If task order uses randomness, use a random number generator seeded with the participant number rather than `Math.random`. If the timeline yields another task than the one logged at that step, or ends before the last completed task, `Run` stops with a `TIMELINE_MISMATCH` error before any task renders: it shows `elements.error` and interrupts the run, so nothing is logged on top of the stored logs. So does a task whose id is already used.

   A result comes back from the server as JSON, so a `Date` in it comes back as a string. Put plain values in results.

`Run` asks before resuming, even when nothing was logged yet, and has no action to start over or cancel the run: canceling is up to the host. Replace the prompt with `elements.resume` if you want to say more; see [Write your own screens](getting-started.md#write-your-own-screens).

If you play the timeline with `TimelinePlayer` instead, it does not replay: pass it `resumeAfter(timeline, predicate)` as its timeline to skip the tasks already done. Its `resumeAfterTask` prop still works but is deprecated. See [Without React](#without-react) for how to replay a timeline yourself.

## Avoid losing progress

Resuming recovers a run, but the logs that hadn't reached the server are lost, and the participant repeats their tasks. So ask the browser to confirm before the page closes or reloads, from the start of the run until it ends: a reload is risky whenever logs are on their way, not only when saving fails.

`Run` does this for you, as long as it stays mounted until the run ends. With `TimelinePlayer`, use `useConfirmBeforeUnload` from `@lightmill/react-experiment`. Without React, listen to `beforeunload`:

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
- **Completed runs can't resume.** A participant who opens the experiment again after completing it gets the same `RUN_EXISTS` error. With `Run`, it reaches your `error` element: show a message rather than an error.
- **Interruptions go unnoticed.** When a participant closes the tab, the run stays `running` until they come back. Hosts see it as running.

## Without React

Steps 1, 2 and 4 are the same. `Run` does step 3 for you; without it, do it with the client.

Find the run. `getResumableRuns` lists the runs this browser started that are running or interrupted. Filter by experiment and run name, and pass your task types as the resumable log types:

```ts
const [resumable] = await client.getResumableRuns({
  experimentName,
  runName,
  resumableLogTypes: ['intro', 'trial'],
});
```

Each result has the run, its experiment, and `toResumeAfter`: the number of the last completion log and the log itself, with its values. When no task was completed yet, `toResumeAfter` is `{ number: 0, log: null }`.

Resume the run. Pass `toResumeAfter` to `startRun` as is:

```ts
const logger = await client.startRun({
  runId: resumable.run.id,
  after: resumable.toResumeAfter,
});
```

With `{ number: 0 }`, the run starts over from the beginning, and every log it had is canceled.

For a fixed list of tasks, skip the tasks already done with `resumeAfter` from `@lightmill/runner` before you run the timeline. It starts after the first task the predicate matches:

```ts
import { resumeAfter, runTimeline } from '@lightmill/runner';

const lastTaskId = resumable.toResumeAfter.log?.taskId;
await runTimeline({
  timeline:
    lastTaskId == null
      ? timeline
      : resumeAfter(timeline, (task) => task.id === lastTaskId),
  runTask,
});
```

The timeline is replayed up to the matching task, so the predicate must be pure. With no saved task id, the whole timeline runs. If a saved id is missing from the timeline, `resumeAfter` throws: investigate the changed design instead of silently repeating every task.

`resumeAfter` passes no result to the tasks it skips. For a timeline that adapts to results, list the run's completion logs with `getRunLogs` and pass each one's values back as you step through the timeline, as `Run` does:

```ts
const completed = await client.getRunLogs({
  runId: resumable.run.id,
  logTypes: ['intro', 'trial'],
});
```

It lists them in log-number order, without the canceled and stranded logs.
