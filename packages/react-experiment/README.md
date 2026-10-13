# @lightmill/react-experiment

Show the tasks of an experiment's timeline in React, one after the other, and log what participants do.

You write one component per task type. `TimelinePlayer` renders the component of the current task, and moves to the next task when the component says it is done. It works on its own, or with [`@lightmill/log-client`](../log-client/README.md) to send logs to a [log server](../log-server/README.md). To show tasks without React, use [`@lightmill/runner`](../runner/README.md).

## Install

```sh
npm install @lightmill/react-experiment
```

It needs React 19.2 or later.

## Example

```tsx
import { TimelinePlayer, useTask } from '@lightmill/react-experiment';

const timeline = [
  { type: 'question', id: 'q1', text: 'Is the sky blue?' },
  { type: 'question', id: 'q2', text: 'Is grass blue?' },
];

function Question() {
  const { task, completeTask } = useTask('question');
  return (
    <div>
      <p>{String(task.text)}</p>
      <button onClick={() => completeTask()}>Next</button>
    </div>
  );
}

export function App() {
  return (
    <TimelinePlayer
      timeline={timeline}
      elements={{
        tasks: { question: <Question /> },
        completed: <p>Thank you!</p>,
      }}
    />
  );
}
```

A task is any object with a `type` and an `id`, unique within the timeline: a task with no id or an id already used throws when it starts, before it shows. `elements.tasks` maps each type to the element that shows it. Each task mounts its element fresh, even when the previous task had the same type, so state, refs, and effects start over at every task.

[Getting started](../../docs/guides/getting-started.md) builds a complete experiment, with logging and resuming.

To send logs to a server and resume interrupted runs, use [`Run`](#run) instead of `TimelinePlayer`.

## Typing tasks and logs

Declare your task and log types once, and every hook gets them:

```ts
type Task = { type: 'question'; id: string; text: string };

type Log =
  | { type: 'question'; taskId: string; answer: boolean }
  | { type: 'hover'; taskId: string; x: number; y: number };

declare module '@lightmill/react-experiment' {
  interface RegisterExperiment {
    task: Task;
    log: Log;
  }
}
```

With several types of tasks or logs, make `Task` or `Log` a union. `useTask('question')` then returns a task of type `{ type: 'question'; id: string; text: string }`, and `TimelinePlayer` requires an element for every task type. Without this declaration, tasks and logs are any object with a `type`, and their other properties are `unknown`.

The log with the same type as a task is that task's completion log: here, `question`. It types the task result, the data a task hands over when it completes, which is the log without `type`, `taskId` and `date`: `{ answer: boolean }`. A task type with no log of the same type has no result.

## Logging

Give `TimelinePlayer` an `onLog` function. Each task writes one completion log when it completes, with the task's type, the task's id in `taskId`, and the task result as its values. Tasks write any other log with `useLogger`. This example uses the `Task` and `Log` types declared above:

```tsx
import type { Logger } from '@lightmill/log-client';
import {
  TimelinePlayer,
  useLogger,
  useTask,
} from '@lightmill/react-experiment';

const timeline: Task[] = [
  { type: 'question', id: 'q1', text: 'Is the sky blue?' },
  { type: 'question', id: 'q2', text: 'Is grass blue?' },
];

function Question() {
  const { task, completeTask } = useTask('question');
  const log = useLogger('hover');
  return (
    <button
      onMouseMove={(event) =>
        log({ taskId: task.id, x: event.clientX, y: event.clientY })
      }
      onClick={() => completeTask({ answer: true })}
    >
      Yes
    </button>
  );
}

export function Experiment({ logger }: { logger: Logger<Log> }) {
  return (
    <TimelinePlayer
      timeline={timeline}
      onLog={(log) => logger.addLog(log)}
      elements={{ tasks: { question: <Question /> } }}
    />
  );
}
```

`logger` is a logger from `@lightmill/log-client`, created for the same `Log` type: without the declaration above, logs have `unknown` values, which `logger.addLog` doesn't accept. `onLog` can send logs anywhere, though: it receives each log, and returns a promise. Neither `completeTask` nor the function `useLogger` returns waits for that promise, so a task can log and complete at once. If the promise rejects, `TimelinePlayer` throws a [`LogDeliveryError`](#logdeliveryerror) on its next render.

Keep task results small, and put bulk data, such as mouse moves, in logs of other types. Resuming a run reads the completion logs back from the server, so large results make it slow.

## API

### `Run`

Runs one run of an experiment with a [`@lightmill/log-client`](../log-client/README.md) client: it starts or resumes the run, plays the timeline, sends the completion logs and the logs from `useLogger`, and completes the run once every log is stored. It is your app's main component, so keep it mounted until the run ends. [Getting started](../../docs/guides/getting-started.md#wire-it-together) shows a complete app.

```tsx
<Run
  client={client}
  experimentName="my-experiment"
  runName={participantId}
  timeline={timeline}
  elements={{ tasks: { question: <Question /> } }}
/>
```

- `client`: a log-client `Client`. Create it once: a new client is a new run. `Run` imports nothing from log-client, it only needs a client with the right methods.
- `experimentName` and `runName`: identify the run on the server. `Run` looks up an ongoing run with the same names, asks the participant to resume it, and starts a new run when there is none. Before the run starts, changing either (or the client) switches to another run. Once it has started, changing one crashes the run with a `RUN_REMOUNTED` error, as a [remount](#remounting) does.
- `timeline`: the tasks, as for `TimelinePlayer`, or `null` while your app loads them. `Run` plays the first timeline it gets once the run is ready, and ignores later changes. When it resumes a run, it replays the timeline up to the last completed task: see [Resuming a dynamic timeline](#resuming-a-dynamic-timeline).
- `elements`: `tasks`, plus a screen for each state, all optional and with a small default: `loading` (also shown while the run is saved, so keep its text neutral), `resume`, `paused`, `error` and `completed`.
- `dangerouslyAutoResume`: when set, `Run` resumes the run it finds without showing `elements.resume`, and shows `elements.loading` meanwhile. Use it in development so that reloading the page puts you back in the run. Never use it in production: if the participant has the same run open in another tab or on another device, that run is resumed without asking, and the logs it wrote after the resume point are canceled.

`Run` asks the browser to confirm before the page unloads until the run ends. While logs can't be delivered, it shows `elements.paused`. If the run can't start or crashes, it shows `elements.error`, interrupts the run so a reload offers to resume it, and keeps the logs it holds recoverable.

Three hooks write your own screens. They only work in the elements of `Run`:

- `useResumeRun()`, for `elements.resume`, returns `{ resume, run, lastLog }`. `lastLog` is the run's last completion log, or `null` when no task was completed yet.
- `useLogDelivery()` returns `{ error, inFlightLogs, retry }`: why delivery is paused, the logs the server has not stored, and a function that sends them again. It never rejects and does nothing outside a pause. It also works in `elements.error`.
- `useRunError()`, for `elements.error`, returns `{ error }`, the value that was thrown.

[Write your own screens](../../docs/guides/getting-started.md#write-your-own-screens) gives the code of every default.

### `TimelinePlayer`

What to show:

- `timeline`: the tasks, as an array, an iterable, an iterator, or their async versions. `TimelinePlayer` reads it once and can't rewind it, so it can't change once set: create it once, outside of rendering, not in the JSX. A remounted `TimelinePlayer` given the same iterator continues where it was: see [Remounting](#remounting). See also [Dynamic timelines](#dynamic-timelines).
- `elements.tasks`: the element to show for each task type. A task with a type missing here throws.
- `elements.loading`: shown while the next task is loading, such as while an async timeline computes it, and while `loading` is `true`.
- `elements.completed`: shown once the timeline is over. Defaults to nothing.
- `elements.paused`: shown while `paused` is `true`. Required when you use `paused`: without it, `TimelinePlayer` throws a `LogDeliveryError`.

What state the player is in:

- `paused`: set it to `true` while logs can't be delivered. `TimelinePlayer` keeps showing the current task, then shows `elements.paused` instead of whatever comes next, including `elements.completed`. The timeline itself keeps going. See [Handling log delivery failures](#handling-log-delivery-failures).
- `loading`: set it to `true` while your app is not ready to move on. `TimelinePlayer` keeps showing the current task, then shows `elements.loading` instead of what comes next. The timeline can be unset while `loading` is `true`. If `loading` goes back to `false` before the current task ends, that task is not restarted. `paused` wins over `loading`.

What happens:

- `onLog(log)`: receives every completion log and every log from `useLogger`, and returns a promise. Without it, tasks still complete, but write no completion log.
- `onCompleted()`: called once when the timeline is over, while `TimelinePlayer` is mounted.

### `resumeAfter(timeline, predicate)`

Re-exported from [`@lightmill/runner`](../runner/README.md). Returns a timeline that starts after the first task for which `predicate(task)` returns `true`, the last task completed before. It throws when no task matches. Create the result once, like any other timeline. See [Resuming runs](../../docs/guides/resuming-runs.md).

`resumeAfter` replays the timeline up to the matching task, so `predicate` must be pure.

```tsx
<TimelinePlayer
  timeline={resumeAfter(tasks, (task) => task.id === lastTaskId)}
  // ...
/>
```

`TimelinePlayer`'s `resumeAfterTask` prop does the same but is deprecated, and will be removed in a future major version.

### `useTask(type?)`

Returns `{ task, completeTask }` for the current task. Call `completeTask(result)` once the task is done; calling it twice throws. `result`, a plain object, is the task result. It goes into the task's completion log and to the timeline, where a generator reads it from `yield`. Its type comes from the completion log: `result` is optional when the log has no required field, and absent when there is no completion log. A completion log is written either way, with no values when there is no result, and the timeline then receives `{}`.

`type`, `taskId` and `date` are reserved: a `result` with one of these keys does not compile, and `completeTask` throws without completing the task.

With a `type`, `useTask` throws if the current task has another type, and narrows the type of `task`. It throws outside of `TimelinePlayer`.

### `useLogger(type?)`

Returns a function that sends a log to `onLog`. With a `type`, the function takes the log without its `type`. Without one, it takes the whole log. Task types are reserved for completion logs: they are left out of the types `useLogger` accepts, and the function throws when given one. It throws outside of `TimelinePlayer`, or when `TimelinePlayer` has no `onLog`.

### `useConfirmBeforeUnload(enabled)`

Asks the browser to confirm before the page is closed or reloaded, as long as `enabled` is `true` and the component is mounted. `TimelinePlayer` never does it by itself: decide when from what you know, such as the logger's state, or whether the timeline is over.

### `LogDeliveryError`

Thrown by `TimelinePlayer` when `onLog` rejects, with the log it could not deliver in its `log` property and the rejection as its `cause`. Also thrown when `paused` is `true` without `elements.paused`. Catch it with an error boundary.

### `TimelinePlayerElements`

The type of the `elements` prop.

## Handling log delivery failures

`TimelinePlayer` does not send logs, so it can't know when sending fails. A logger from `@lightmill/log-client` retries failed requests for a while, then pauses and keeps the logs until you call `retry()`. Read its state and pass it to `TimelinePlayer`, so participants don't move on while their answers aren't saved:

```tsx
function Experiment({
  logger,
  timeline,
}: {
  logger: Logger;
  timeline: Task[];
}) {
  const state = useSyncExternalStore(logger.subscribe, () => logger.state);
  // Leaving before the run ends loses the logs not saved yet.
  useConfirmBeforeUnload(
    !['completed', 'canceled', 'interrupted'].includes(state.status),
  );
  return (
    <TimelinePlayer
      timeline={timeline}
      // The logger keeps the logs a pause rejects, so only other errors are
      // rethrown.
      onLog={(log) =>
        logger.addLog(log).catch((error) => {
          if (logger.state.status !== 'paused') throw error;
        })
      }
      paused={state.status === 'paused'}
      elements={{
        tasks: { question: <Question /> },
        paused: <Paused logger={logger} />,
      }}
    />
  );
}

function Paused({ logger }: { logger: Logger }) {
  return (
    <div>
      <p>Your answers could not be saved. Check your connection.</p>
      <button onClick={() => logger.retry().catch(() => {})}>Try again</button>
      <button onClick={() => download(JSON.stringify(logger.inFlightLogs))}>
        Download unsaved logs
      </button>
    </div>
  );
}
```

`retry()` sends the held logs again. While it runs, the logger state goes back to `sending` and `TimelinePlayer` moves on; if it fails again, the state becomes `paused` once more. `download` stands for your app's file-saving function; the [getting started guide](../../docs/guides/getting-started.md#paused) implements it with a download link. For logs with non-JSON values, such as `bigint`, adapt the download's serialization too.

Held logs are lost if the page closes: see [unsaved logs](../log-client/README.md#unsaved-logs).

[`Run`](#run) does all of this for you, and starts the run, completes it once every log is stored, and confirms before the page closes.

## Dynamic timelines

A timeline can be a generator, which computes each task when the previous one completes. This makes adaptive designs possible, such as a staircase that makes a task harder after each correct answer:

```tsx
const nextLevel = (level: number, correct: boolean) =>
  Math.max(1, level + (correct ? 1 : -1));

function* staircase(
  firstTrial = 0,
  firstLevel = 5,
): Generator<
  { type: 'trial'; id: string; trial: number; level: number },
  void,
  { correct: boolean } | undefined
> {
  let level = firstLevel;
  for (let trial = firstTrial; trial < 20; trial++) {
    const result = yield { type: 'trial', id: `trial-${trial}`, trial, level };
    level = nextLevel(level, result?.correct === true);
  }
}

function Trial() {
  const { task, completeTask } = useTask('trial');
  return (
    <div>
      <p>Level {String(task.level)}</p>
      <button onClick={() => completeTask({ correct: true })}>Correct</button>
      <button onClick={() => completeTask({ correct: false })}>Wrong</button>
    </div>
  );
}

// Created once: a new timeline on every render would throw.
const timeline = staircase();

export function App() {
  return (
    <TimelinePlayer
      timeline={timeline}
      elements={{ tasks: { trial: <Trial /> } }}
    />
  );
}
```

`completeTask(result)` asks the generator for the next task, and `yield` returns `result`. It returns `{}` when the task completed without a result. An async generator works the same way, and `elements.loading` shows while it computes the next task.

## Resuming a dynamic timeline

When `Run` resumes a run, it replays the timeline: it reads the run's completion logs from the server, then asks the timeline for each completed task in turn, without showing it, and passes back the result that task logged, as `completeTask` did. The staircase above gets the same answers, so it reaches the level where the participant stopped, with nothing else to log:

```tsx
<Run
  client={client}
  experimentName="staircase"
  runName={participantId}
  timeline={staircase()}
  elements={{ tasks: { trial: <Trial /> } }}
/>
```

`Run` reads `timeline` once per run, so creating the generator while rendering is fine. The replay checks that each task has the id and type of the completion log at that step. If the timeline changed, it stops the run with a `TIMELINE_MISMATCH` error before any task shows. Then the run continues with the task in progress when the participant left, which is played again: its earlier logs are canceled. See [Resuming runs](../../docs/guides/resuming-runs.md).

`TimelinePlayer` does not replay. `resumeAfter` skips tasks without passing their results back, so a generator resumed with it does not get the answers the participant gave. To resume one with `TimelinePlayer`, list the completion logs with log-client's `getRunLogs` and pass their values back yourself, as `Run` does.

## Sharing state between tasks

Each task mounts fresh, so state that must outlive a task can't live in the task component. Keep it above `TimelinePlayer`, in a component that stays mounted (`useState`, `useRef`, or context), or in a store outside React, as `answers` above. Tasks read it, and write it back when they complete.

## StrictMode

`TimelinePlayer` works in `StrictMode` and inside `<Activity>`: it reads the timeline once, whatever React does with effects. When `<Activity>` hides `TimelinePlayer` as the timeline completes, `onCompleted` is called once it is shown again.

## Remounting

An iterator (a generator, a `resumeAfter` result, `array.values()`, an async iterator) is consumed once, so `TimelinePlayer` remembers where it is in it for as long as the iterator lives. When `TimelinePlayer` unmounts and mounts again with the same iterator, it shows what the previous one showed: the task in progress, which starts afresh since its component state is lost, `elements.loading` while the next task loads, or `elements.completed` once the timeline is over, without playing it again. If the timeline ended with an error, `TimelinePlayer` throws that error again. Give it a new iterator to start over.

Unmounting does not stop the timeline: if it is waiting for the next task, the task is there when `TimelinePlayer` mounts again.

`resumeAfterTask` is only read the first time `TimelinePlayer` sees an iterator. Wrap the timeline with `resumeAfter` instead.

Anything that is not an iterator, such as an array or a `Set`, can be iterated again, so `TimelinePlayer` plays it from the start on every mount. An iterator is one pass through the tasks, and `TimelinePlayer` continues it. An array is a source of passes, and each mount takes a new one.

`Run` works differently. It reads `timeline` once per run, not on every mount, and plays it once, even an array. Once the run has started, `Run` can't be remounted: the task in progress would lose its state and start again, logging on top of its first attempt. So a new `Run` on a started run crashes it with a `RUN_REMOUNTED` error, shows `elements.error` and interrupts the run, and reloading the page offers to resume it. A second `Run` with the same client and names does the same. `StrictMode`, `<Activity>`, and a Fast Refresh that keeps state are not remounts. It reads `timeline` again only for a new run: when you change the client, the experiment name or the run name before the run starts, or after the previous run ended.
