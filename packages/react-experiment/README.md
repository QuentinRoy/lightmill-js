# @lightmill/react-experiment

React utilities to render and run timeline-based Lightmill experiments.

This package provides:

1. `TimelinePlayer` component to execute a timeline and render task components.
2. `useTask` hook to access current task and complete it.
3. `useLogger` hook to emit logs from task components.
4. `RegisterExperiment` type to register task/log unions globally.

## Install

```sh
npm install @lightmill/react-experiment react
```

Requires React 19.2 or later.

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
import {
  TimelinePlayer,
  useTask,
  useLogger,
} from '@lightmill/react-experiment';

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
<TimelinePlayer
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

### `TimelinePlayer` component

Props:

- `timeline`: iterator/iterable of tasks. `TimelinePlayer` consumes it once and it cannot be changed after it is set, so remounting `TimelinePlayer` needs a fresh timeline.
- `elements.tasks`: map from task type to React element.
- `elements.loading`: optional element to render while `loading` is `true`, once the task that was running has ended. It wins over `elements.completed`, and loses to `elements.paused`.
- `elements.completed`: optional completion element.
- `elements.paused`: element to render while `paused` is `true`, once the task that was running has ended. Recommended if you set `paused`. Without it, `TimelinePlayer` throws a `LogDeliveryError`.
- `paused`: set it to `true` when logs cannot be delivered. `TimelinePlayer` keeps rendering the running task, then `elements.paused` instead of what comes next (including `elements.completed`). The timeline and `onCompleted` are not affected. See [Handling log delivery failures](#handling-log-delivery-failures).
- `loading`: set it to `true` while the app is not ready to move on (the timeline may then be unset). `TimelinePlayer` keeps rendering the running task, then `elements.loading` instead of what comes next. If `loading` goes back to `false` before the task ends, the task is not restarted.
- `onLog`: optional async log handler.
- `onCompleted`: optional callback after completion. Called once, and only while `TimelinePlayer` is mounted.
- `resumeAfterTask`: optional function that returns `true` for the last completed task. `TimelinePlayer` starts after the first task it matches, and throws if none does.

### `LogDeliveryError`

Thrown by `TimelinePlayer` when `paused` is `true` and there is no `elements.paused`: logs could not be delivered and nothing handles it. Also thrown when `onLog` rejects, with the log it could not deliver in its `log` property. Catch it with an error boundary.

### `useConfirmBeforeUnload(enabled)`

Asks the browser to confirm before the page is closed or reloaded, for as long as `enabled` is `true` and the calling component is mounted. `TimelinePlayer` never does it by itself: decide when from the state you have, such as the logger's state (see [Handling log delivery failures](#handling-log-delivery-failures)) or the timeline when there is no logger.

### `useTask(type?)`

Returns `{ task, onTaskCompleted }` for current running task.

- With `type`, validates task type at runtime and narrows type.
- Without `type`, returns the currently running registered task type.

### `useLogger(type?)`

Returns a logger function bound to `TimelinePlayer`'s `onLog`.

- With `type`, returned function only needs log payload fields (without `type`).
- Without `type`, returned function accepts full registered log objects.

## Handling log delivery failures

`TimelinePlayer` does not deliver logs, so it does not know when delivery fails. With [`@lightmill/log-client`](../log-client/README.md), read the logger's state and pass it to `TimelinePlayer`:

```tsx
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { Logger } from '@lightmill/log-client';
import {
  TimelinePlayer,
  useConfirmBeforeUnload,
} from '@lightmill/react-experiment';

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

  // Leaving before the run ends loses progress, and logs held or on their way
  // to the server.
  const runEnded = ['completed', 'canceled', 'interrupted'].includes(
    state.status,
  );
  useConfirmBeforeUnload(!runEnded);

  return (
    <TimelinePlayer
      timeline={timeline}
      // A rejected `onLog` throws in `TimelinePlayer`. The logs a pause rejects
      // are kept by the logger, so only other errors are rethrown.
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

`retry()` sends the held logs again. While it runs, the logger state goes back to `sending` and `TimelinePlayer` resumes; if it fails again, the state becomes `paused` once more. `download` stands for whatever your app uses to save a file.
