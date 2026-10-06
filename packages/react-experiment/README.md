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

## Typing tasks and logs

Declare your task and log types once, and every hook gets them:

```ts
type Task =
  | { type: 'question'; id: string; text: string }
  | { type: 'rating'; id: string; scale: number };

type Log =
  | { type: 'answer'; taskId: string; answer: boolean }
  | { type: 'rating'; taskId: string; value: number };

declare module '@lightmill/react-experiment' {
  interface RegisterExperiment {
    task: Task;
    log: Log;
  }
}
```

`useTask('question')` then returns a task of type `{ type: 'question'; id: string; text: string }`, and `TimelinePlayer` requires an element for every task type. Without this declaration, tasks and logs are any object with a `type`, and their other properties are `unknown`.

## Logging

Give `TimelinePlayer` an `onLog` function, and log from task components with `useLogger`:

```tsx
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

<TimelinePlayer
  timeline={timeline}
  onLog={(log) => logger.addLog(log)}
  elements={{ tasks: { question: <Question /> } }}
/>;
```

`logger` is a logger from `@lightmill/log-client`, but `onLog` can send logs anywhere: it receives each log, and returns a promise. The function `useLogger` returns does not wait for that promise, so a task can log and complete at once. If the promise rejects, `TimelinePlayer` throws a [`LogDeliveryError`](#logdeliveryerror) on its next render.

## API

### `TimelinePlayer`

What to show:

- `timeline`: the tasks, as an array, an iterable, an iterator, or their async versions. `TimelinePlayer` reads it once and can't rewind it, so it can't change once set: create it once, outside of rendering, not in the JSX. Remounting `TimelinePlayer` needs a new timeline. See [Dynamic timelines](#dynamic-timelines).
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
- `resumeAfterTask(task)`: returns `true` for the last task completed before. `TimelinePlayer` skips every task up to the first one it matches, and starts with the next. It throws when no task matches. See [Resuming runs](../../docs/guides/resuming-runs.md).

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

`retry()` sends the held logs again. While it runs, the logger state goes back to `sending` and `TimelinePlayer` moves on; if it fails again, the state becomes `paused` once more. `download` stands for whatever your app uses to save a file.

[Getting started](../../docs/guides/getting-started.md#wire-it-together) shows the rest: starting the run, completing it once every log is stored, and confirming before the page closes.

## Dynamic timelines

A timeline can be a generator, which computes each task when the previous one completes. This makes adaptive designs possible, such as a staircase that makes a task harder after each correct answer:

```tsx
const answers: boolean[] = [];

function* staircase(): Generator<{ type: 'trial'; id: string; level: number }> {
  let level = 5;
  for (let i = 0; i < 20; i++) {
    yield { type: 'trial', id: `trial-${i}`, level };
    const correct = answers[i];
    if (typeof correct !== 'boolean') {
      throw new Error(`Missing answer for trial-${i}`);
    }
    level = Math.max(1, level + (correct ? 1 : -1));
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

<TimelinePlayer
  timeline={timeline}
  elements={{ tasks: { trial: <Trial /> } }}
/>;
```

Record the answer before calling `onTaskCompleted`: that call asks the generator for the next task. An async generator works the same way, and `elements.loading` shows while it computes the next task.

This generator reads the answer for each trial by its index. That matters when resuming: `resumeAfterTask` advances the generator through earlier tasks without mounting their components. Reading only the most recent answer would apply that answer to every skipped trial and change the difficulty.

For example, on a fresh page, restore two saved answers before creating the timeline:

```tsx
answers.push(true, false);
const resumedTimeline = staircase();

<TimelinePlayer
  timeline={resumedTimeline}
  resumeAfterTask={(task) => task.id === 'trial-1'}
  elements={{ tasks: { trial: <Trial /> } }}
/>;
```

The skipped trials have levels 5 and 6; the next task, `trial-2`, has level 5, as it did in the original run. New answers are appended after the restored ones. Create a fresh answer array and generator for each run.

In an app that saves data, log each completed trial's `taskId`, `correct`, and `level` with `useLogger`, before calling `onTaskCompleted`. To resume:

1. Find the run and its saved completion log with `getResumableRuns`.
2. Fetch the earlier trial logs as [JSON](../../docs/guides/exporting-data.md#as-json), with `filter[run.id]` set to this run's id and `filter[logType]=trial`. `getResumableRuns` returns only the resume point, not the answer history.
3. Keep only logs with `number` at or below `toResumeAfter.number`, and sort them by `number`. Check that their task ids are `trial-0`, `trial-1`, and so on, with a boolean `correct` for each. Stop if the history is incomplete.
4. Restore those answers, create the generator, and resume the run with `startRun({ runId, after: toResumeAfter })`. Pass the saved task id to `resumeAfterTask`.

The generator must replay each saved answer in order. If an adaptive design depends on other state or randomness, save and restore that too.

## Sharing state between tasks

Each task mounts fresh, so state that must outlive a task can't live in the task component. Keep it above `TimelinePlayer`, in a component that stays mounted (`useState`, `useRef`, or context), or in a store outside React, as `answers` above. Tasks read it, and write it back when they complete.

## StrictMode

`TimelinePlayer` works in `StrictMode` and inside `<Activity>`: it reads the timeline once, whatever React does with effects. When `<Activity>` hides `TimelinePlayer` as the timeline completes, `onCompleted` is called once it is shown again.
