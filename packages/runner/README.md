# @lightmill/runner

Go through an experiment's timeline one task at a time, without any interface code.

The runner hands you each task of a timeline and waits until you say it is done before it moves to the next one. Use it to show tasks with plain DOM code or any framework. With React, use [`@lightmill/react-experiment`](../react-experiment/README.md), which is built on it.

## Install

```sh
npm install @lightmill/runner
```

## Example

`runTimeline` calls an async function for each task, and waits for it before the next one:

```ts
import { runTimeline } from '@lightmill/runner';

const timeline = [
  { type: 'question', text: 'Is the sky blue?' },
  { type: 'question', text: 'Is grass blue?' },
];

await runTimeline({
  timeline,
  runTask: async (task) => {
    const answer = await askQuestion(task.text);
    await logger.addLog({ type: 'answer', text: task.text, answer });
  },
});
```

`askQuestion` stands for your own interface code, and `logger` for a logger from [`@lightmill/log-client`](../log-client/README.md).

When the code that shows a task is not a single async function, such as event handlers or a UI framework, use `TimelineRunner`: it calls `onTaskStarted` for each task, and moves on when you call `completeTask()`.

```ts
import { TimelineRunner } from '@lightmill/runner';

const runner = new TimelineRunner({
  timeline,
  onTaskStarted(task) {
    showQuestion(task.text);
  },
  onTimelineCompleted() {
    showThanks();
  },
});

answerButton.onclick = () => runner.completeTask();
runner.start();
```

## Timelines

A timeline is any of:

- an array, or any other iterable, of tasks;
- a generator, which computes each task when the previous one completes;
- an async iterable or async generator, for tasks that take time to compute or fetch;
- an iterator whose `next()` returns a promise only sometimes.

A generator makes adaptive designs possible, such as a staircase that changes difficulty after each answer:

```ts
const answers: boolean[] = [];

function* staircase() {
  let level = 5;
  for (let i = 0; i < 20; i++) {
    yield { type: 'trial', level };
    const correct = answers[i];
    if (typeof correct !== 'boolean') {
      throw new Error(`Missing answer for trial ${i}`);
    }
    level = Math.max(1, level + (correct ? 1 : -1));
  }
}
```

Record each answer in `answers` before the task completes: completing it asks the generator for the next task.

To resume, restore the saved answers in order before advancing the generator past completed tasks. Reading `answers[i]` replays each trial's answer; reading only the last answer would change the difficulty of skipped trials. See [Dynamic timelines](../react-experiment/README.md#dynamic-timelines) for the logging and recovery steps.

The runner reads the timeline once and can't rewind it. To start over, create a new timeline and a new runner.

## `runTimeline({ timeline, runTask })`

Calls `runTask(task)` for each task in turn, waiting for the promise it returns. Resolves once the timeline is over. Rejects as soon as `runTask` rejects, or the timeline throws, and stops there. It can't be canceled: use `TimelineRunner` for that.

## `TimelineRunner`

### Options

| Option                  | Called                                                                    |
| ----------------------- | ------------------------------------------------------------------------- |
| `timeline`              | The timeline. Required.                                                   |
| `onTimelineStarted()`   | Once, when `start()` is called.                                           |
| `onLoading()`           | When the timeline returns a promise, while the runner waits for the task. |
| `onTaskStarted(task)`   | For each task.                                                            |
| `onTaskCompleted(task)` | When `completeTask()` is called.                                          |
| `onTimelineCompleted()` | Once, after the last task.                                                |
| `onTimelineCanceled()`  | Once, when `cancel()` is called.                                          |
| `onError(error)`        | When the timeline throws or rejects.                                      |

The callbacks are also properties of the runner, which you can set after creating it.

### Methods

- `start()` starts the timeline. Throws if it has already started.
- `completeTask()` completes the current task and moves to the next one. Throws when no task is running, when the task is already completed, or when the timeline is canceled.
- `cancel()` stops the timeline: no other task starts, and a task the timeline is still computing is ignored. Throws when the timeline is already canceled or completed.
- `status` is `idle` before `start()`, then `running` while a task runs, `loading` while the runner waits for an async timeline, and finally `completed`, `canceled`, or `crashed`.

`start()`, `completeTask()`, and `cancel()` return the runner. `completeTask()` and `cancel()` work from inside callbacks too.

### Order of calls

With a synchronous timeline, the next task starts before `completeTask()` returns: `completeTask()` calls `onTaskCompleted` for the current task, then `onTaskStarted` for the next one, or `onTimelineCompleted`. Calling `completeTask()` from inside `onTaskStarted` works, even for long timelines.

With an async timeline, `onLoading` is called between the two, and the next task starts once the timeline's promise resolves.

### Errors

When the timeline throws or rejects, the status becomes `crashed` and the runner calls `onError`. Without `onError`, the error is thrown from the call that asked for the task, `start()` or `completeTask()`, or, for an async timeline, becomes an unhandled rejection.

When `onTaskStarted` throws, the status becomes `crashed`, and the error is thrown from `start()` or `completeTask()`.

## Types

`RunTimelineParams` and `TimelineRunnerParams` are the parameters of `runTimeline` and `TimelineRunner`. `SuperIterator<Task>` is any timeline the runner accepts, and `MaybeAsyncIterator<Task>` an iterator whose `next()` may return a promise.
