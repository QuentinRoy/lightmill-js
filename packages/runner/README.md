# @lightmill/runner

Run timeline-based experiments with sync or async iterators.

This package provides two public APIs:

1. `run(...)`: convenience function that executes an entire timeline.
2. `Runner`: class API (`TimelineRunner`) for fine-grained lifecycle control.

## Install

```sh
npm install @lightmill/runner
```

## Usage

### `run(...)`

```ts
import { run } from '@lightmill/runner';

await run({
  timeline: [{ id: 't1' }, { id: 't2' }],
  runTask: async (task) => {
    console.log(task.id);
  },
});
```

### `Runner`

```ts
import { Runner } from '@lightmill/runner';

const runner = new Runner({
  timeline: [{ id: 't1' }, { id: 't2' }],
  onTaskStarted(task) {
    console.log('task started', task.id);
    runner.completeTask();
  },
});

runner.start();
```

## API Reference

### `run(params)`

Parameters:

| Param             | Type                                                     | Description                                |
| ----------------- | -------------------------------------------------------- | ------------------------------------------ |
| `params.timeline` | `Iterator \| Iterable \| AsyncIterator \| AsyncIterable` | Source timeline.                           |
| `params.runTask`  | `(task) => PromiseLike<void>`                            | Async task executor called for every task. |

Returns:

- `Promise<void>` resolved when timeline completes.

### `class Runner<Task>`

Lifecycle callbacks in constructor options:

| Option                  | Description                                   |
| ----------------------- | --------------------------------------------- |
| `onTimelineStarted`     | Called once when `start()` is called.         |
| `onLoading`             | Called while awaiting async iterator results. |
| `onTaskStarted(task)`   | Called for each emitted task.                 |
| `onTaskCompleted(task)` | Called when `completeTask()` is called.       |
| `onTimelineCanceled`    | Reserved callback for cancellation flows.     |
| `onError(error)`        | Called when iterator loading fails.           |
| `onTimelineCompleted`   | Called once at the end of timeline.           |

Public methods:

| Method           | Description                                                                              |
| ---------------- | ---------------------------------------------------------------------------------------- |
| `start()`        | Start timeline execution.                                                                |
| `completeTask()` | Mark current task complete and continue.                                                 |
| `cancel()`       | Stop timeline execution.                                                                 |
| `status`         | Current runner status: `idle`, `loading`, `running`, `completed`, `canceled`, `crashed`. |
