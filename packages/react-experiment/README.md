# @lightmill/react-experiment

React utilities to render and run timeline-based Lightmill experiments.

This package provides:

1. `Run` component to execute a timeline and render task components.
2. `useTask` hook to access current task and complete it.
3. `useLogger` hook to emit logs from task components.
4. `RegisterExperiment` type to register task/log unions globally.

## Install

```sh
npm install @lightmill/react-experiment react
```

## Type Registration

Augment `RegisterExperiment` with your task/log types:

```ts
import type { RegisterExperiment } from '@lightmill/react-experiment';

type Task =
  | { type: 'intro'; id: string; text: string }
  | { type: 'trial'; id: string; stimulus: string };

type Log =
  | { type: 'started'; taskId: string }
  | { type: 'answered'; taskId: string; answer: string };

declare module '@lightmill/react-experiment' {
  interface RegisterExperiment {
    task: Task;
    log: Log;
  }
}
```

## Usage

```tsx
import { Run, useTask, useLogger } from '@lightmill/react-experiment';

function IntroTask() {
  const { task, onTaskCompleted } = useTask('intro');
  const log = useLogger('started');

  return (
    <button
      onClick={() => {
        log({ taskId: task.id });
        onTaskCompleted();
      }}
    >
      Start: {task.text}
    </button>
  );
}

function TrialTask() {
  const { task, onTaskCompleted } = useTask('trial');
  const log = useLogger('answered');

  return (
    <button
      onClick={() => {
        log({ taskId: task.id, answer: 'yes' });
        onTaskCompleted();
      }}
    >
      {task.stimulus}
    </button>
  );
}
```

```tsx
<Run
  timeline={timeline}
  onLog={async (log) => {
    await logger.addLog(log);
  }}
  elements={{
    loading: <p>Loading...</p>,
    completed: <p>Done</p>,
    tasks: { intro: <IntroTask />, trial: <TrialTask /> },
  }}
/>
```

## API Reference

### `Run` component

Props:

- `timeline`: iterator/iterable of tasks.
- `elements.tasks`: map from task type to React element.
- `elements.loading`: optional loading element.
- `elements.completed`: optional completion element.
- `onLog`: optional async log handler.
- `onCompleted`: optional callback after completion.
- `resumeAfter`: optional `{ type, number }` marker to skip completed tasks.
- `confirmBeforeUnload`: default `true`.

### `useTask(type?)`

Returns `{ task, onTaskCompleted }` for current running task.

- With `type`, validates task type at runtime and narrows type.
- Without `type`, returns the currently running registered task type.

### `useLogger(type?)`

Returns a logger function bound to `Run`'s `onLog`.

- With `type`, returned function only needs log payload fields (without `type`).
- Without `type`, returned function accepts full registered log objects.
