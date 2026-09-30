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
- `elements.paused`: element to render while `paused` is `true`, once the task that was running has ended. Required if `paused` is set.
- `paused`: set it to `true` when logs cannot be delivered. `Run` keeps rendering the running task, then `elements.paused` instead of what comes next (including `elements.completed`). The timeline and `onCompleted` are not affected. See [Handling log delivery failures](#handling-log-delivery-failures).
- `onLog`: optional async log handler.
- `onCompleted`: optional callback after completion.
- `resumeAfter`: optional `{ type, number }` marker to skip completed tasks.
- `confirmBeforeUnload`: default `true`. Turned off once the timeline is completed, unless `paused` is `true`.

### `LogDeliveryError`

Thrown by `Run` when `paused` is set without `elements.paused`. Catch it with an error boundary.

### `useTask(type?)`

Returns `{ task, onTaskCompleted }` for current running task.

- With `type`, validates task type at runtime and narrows type.
- Without `type`, returns the currently running registered task type.

### `useLogger(type?)`

Returns a logger function bound to `Run`'s `onLog`.

- With `type`, returned function only needs log payload fields (without `type`).
- Without `type`, returned function accepts full registered log objects.

## Handling log delivery failures

`Run` does not deliver logs, so it does not know when delivery fails. With [`@lightmill/log-client`](../log-client/README.md), read the logger's state and pass it to `Run`:

```tsx
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { Logger } from '@lightmill/log-client';
import { Run } from '@lightmill/react-experiment';

function Experiment({
  logger,
  timeline,
}: {
  logger: Logger;
  timeline: Task[];
}) {
  const state = useSyncExternalStore(logger.subscribe, () => logger.state);
  const [timelineCompleted, setTimelineCompleted] = useState(false);

  // completeRun() rejects while logs are held. Waiting for idle completes the
  // run once they are stored, even after a pause.
  useEffect(() => {
    if (timelineCompleted && state.status === 'idle') {
      logger.completeRun().catch(console.error);
    }
  }, [logger, timelineCompleted, state.status]);

  return (
    <Run
      timeline={timeline}
      // A rejected `onLog` throws in `Run`. The logs a pause rejects are kept
      // by the logger, so only other errors are rethrown.
      onLog={(log) =>
        logger.addLog(log).catch((error) => {
          if (logger.state.status !== 'paused') throw error;
        })
      }
      onCompleted={() => setTimelineCompleted(true)}
      paused={state.status === 'paused'}
      elements={{
        tasks: { intro: <IntroTask />, trial: <TrialTask /> },
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

`retry()` sends the held logs again. While it runs, the logger state goes back to `sending` and `Run` resumes; if it fails again, the state becomes `paused` once more. `download` stands for whatever your app uses to save a file.

`Run` turns the unload confirmation off once the timeline is completed, unless `paused` is `true`. Logs still being sent at that point are not protected: add your own `beforeunload` listener if you need it.
