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
  const { task, onTaskCompleted } = useTask('question');
  return (
    <div>
      <p>{String(task.text)}</p>
      <button onClick={onTaskCompleted}>Next</button>
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

A task is any object with a `type`. `elements.tasks` maps each type to the element that shows it. Each task mounts its element fresh, even when the previous task had the same type, so state, refs, and effects start over at every task.

[Getting started](../../docs/guides/getting-started.md) builds a complete experiment, with logging and resuming.

To send logs to a server and resume interrupted runs, use [`Run`](#run) instead of `TimelinePlayer`.

## Typing tasks and logs

Declare your task and log types once, and every hook gets them:

```ts
type Task = { type: 'question'; id: string; text: string };

type Log = { type: 'answer'; taskId: string; answer: boolean };

declare module '@lightmill/react-experiment' {
  interface RegisterExperiment {
    task: Task;
    log: Log;
  }
}
```

With several types of tasks or logs, make `Task` or `Log` a union. `useTask('question')` then returns a task of type `{ type: 'question'; id: string; text: string }`, and `TimelinePlayer` requires an element for every task type. Without this declaration, tasks and logs are any object with a `type`, and their other properties are `unknown`.

## Logging

Give `TimelinePlayer` an `onLog` function, and log from task components with `useLogger`. This example uses the `Task` and `Log` types declared above:

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
  const { task, onTaskCompleted } = useTask('question');
  const log = useLogger('answer');
  return (
    <button
      onClick={() => {
        log({ taskId: task.id, answer: true });
        onTaskCompleted();
      }}
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

`logger` is a logger from `@lightmill/log-client`, created for the same `Log` type: without the declaration above, logs have `unknown` values, which `logger.addLog` doesn't accept. `onLog` can send logs anywhere, though: it receives each log, and returns a promise. The function `useLogger` returns does not wait for that promise, so a task can log and complete at once. If the promise rejects, `TimelinePlayer` throws a [`LogDeliveryError`](#logdeliveryerror) on its next render.

## API

### `Run`

Runs one run of an experiment with a [`@lightmill/log-client`](../log-client/README.md) client: it starts or resumes the run, plays the timeline, sends the logs from `useLogger`, and completes the run once every log is stored. It is your app's main component, so keep it mounted until the run ends. [Getting started](../../docs/guides/getting-started.md#wire-it-together) shows a complete app.

```tsx
<Run
  client={client}
  experimentName="my-experiment"
  runName={participantId}
  resumableLogTypes={['answer']}
  timeline={({ resumeLog }) => buildTimeline(resumeLog)}
  elements={{ tasks: { question: <Question /> } }}
/>
```

- `client`: a log-client `Client`. Create it once: a new client is a new run. `Run` imports nothing from log-client, it only needs a client with the right methods.
- `experimentName` and `runName`: identify the run on the server. `Run` looks up an ongoing run with the same names, asks the participant to resume it, and starts a new run when there is none. Changing either (or the client) switches to another run.
- `resumableLogTypes`: the log types that mark a completed task. `Run` resumes after the last log of one of these types.
- `timeline`: a function that builds the timeline, or `null` while your app loads it. `Run` calls it once per run, with `resumeLog`: the last resumable log, or `null` for a new run or when none was logged yet. See [Resuming a dynamic timeline](#resuming-a-dynamic-timeline).
- `elements`: `tasks`, plus a screen for each state, all optional and with a small default: `loading` (also shown while the run is saved, so keep its text neutral), `resume`, `paused`, `error` and `completed`.

`Run` asks the browser to confirm before the page unloads until the run ends. While logs can't be delivered, it shows `elements.paused`. If the run can't start or crashes, it shows `elements.error`, interrupts the run so a reload offers to resume it, and keeps the logs it holds recoverable.

Three hooks write your own screens. They only work in the elements of `Run`:

- `useResumeRun()`, for `elements.resume`, returns `{ resume, run, lastLog }`.
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

- `onLog(log)`: receives every log from `useLogger`, and returns a promise.
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

Returns `{ task, onTaskCompleted }` for the current task. Call `onTaskCompleted()` once the task is done; calling it twice throws.

With a `type`, `useTask` throws if the current task has another type, and narrows the type of `task`. It throws outside of `TimelinePlayer`.

### `useLogger(type?)`

Returns a function that sends a log to `onLog`. With a `type`, the function takes the log without its `type`. Without one, it takes the whole log. It throws outside of `TimelinePlayer`, or when `TimelinePlayer` has no `onLog`.

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
const answers: boolean[] = [];

const nextLevel = (level: number, correct: boolean) =>
  Math.max(1, level + (correct ? 1 : -1));

function* staircase(
  firstTrial = 0,
  firstLevel = 5,
): Generator<{ type: 'trial'; id: string; trial: number; level: number }> {
  let level = firstLevel;
  for (let trial = firstTrial; trial < 20; trial++) {
    yield { type: 'trial', id: `trial-${trial}`, trial, level };
    level = nextLevel(level, answers.at(-1) === true);
  }
}

function Trial() {
  const { task, onTaskCompleted } = useTask('trial');
  const answer = (correct: boolean) => {
    answers.push(correct);
    onTaskCompleted();
  };
  return (
    <div>
      <p>Level {String(task.level)}</p>
      <button onClick={() => answer(true)}>Correct</button>
      <button onClick={() => answer(false)}>Wrong</button>
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

Record the answer before calling `onTaskCompleted`: that call asks the generator for the next task. An async generator works the same way, and `elements.loading` shows while it computes the next task.

## Resuming a dynamic timeline

`resumeAfter` replays a generator without mounting any task, so the generator does not get the answers the participant gave, and can't reproduce the task where they stopped. Instead, log the state the generator needs when each trial completes, and build a new generator from the last log. `Run` hands it to the `timeline` function as `resumeLog`:

```tsx
function Trial() {
  const { task, onTaskCompleted } = useTask('trial');
  const log = useLogger('trial-done');
  const answer = (correct: boolean) => {
    answers.push(correct);
    log({
      taskId: task.id,
      trial: task.trial,
      nextLevel: nextLevel(task.level, correct),
    });
    onTaskCompleted();
  };
  // ...
}

<Run
  client={client}
  experimentName="staircase"
  runName={participantId}
  resumableLogTypes={['trial-done']}
  timeline={({ resumeLog }) =>
    resumeLog == null
      ? staircase()
      : staircase(resumeLog.trial + 1, resumeLog.nextLevel)
  }
  elements={{ tasks: { trial: <Trial /> } }}
/>;
```

The example registers its types as in [Typing tasks and logs](#typing-tasks-and-logs): a `trial` task with `trial` and `level` numbers, and a `trial-done` log with `taskId`, `trial` and `nextLevel`. A resumable log must mark a completed task: `Run` resumes after the last `trial-done`, so the trial in progress is played again. For a fixed list of tasks, `resumeAfter(tasks, (task) => task.id === resumeLog.taskId)` is enough. See [Resuming runs](../../docs/guides/resuming-runs.md).

## Sharing state between tasks

Each task mounts fresh, so state that must outlive a task can't live in the task component. Keep it above `TimelinePlayer`, in a component that stays mounted (`useState`, `useRef`, or context), or in a store outside React, as `answers` above. Tasks read it, and write it back when they complete.

## StrictMode

`TimelinePlayer` works in `StrictMode` and inside `<Activity>`: it reads the timeline once, whatever React does with effects. When `<Activity>` hides `TimelinePlayer` as the timeline completes, `onCompleted` is called once it is shown again.

## Remounting

An iterator (a generator, a `resumeAfter` result, `array.values()`, an async iterator) is consumed once, so `TimelinePlayer` remembers where it is in it for as long as the iterator lives. When `TimelinePlayer` unmounts and mounts again with the same iterator, it shows what the previous one showed: the task in progress, which starts afresh since its component state is lost, `elements.loading` while the next task loads, or `elements.completed` once the timeline is over, without playing it again. If the timeline ended with an error, `TimelinePlayer` throws that error again. Give it a new iterator to start over.

Unmounting does not stop the timeline: if it is waiting for the next task, the task is there when `TimelinePlayer` mounts again.

`resumeAfterTask` is only read the first time `TimelinePlayer` sees an iterator. Wrap the timeline with `resumeAfter` instead.

Anything that is not an iterator, such as an array or a `Set`, can be iterated again: each mount plays it from the start.
