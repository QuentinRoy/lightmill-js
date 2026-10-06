# Getting started

This tutorial builds a small reaction-time experiment from scratch and collects its data. Each participant clicks a button as soon as it appears, five times with a small button and five times with a large one. Half of the participants start with the small button, the other half with the large one.

By the end, you will have:

- a React app that shows the tasks one after the other,
- a log server that stores what participants do,
- participants who can reload the page and continue after their saved progress,
- a CSV file with the results.

You need Node.js 24.12 or later and a terminal. The tutorial uses npm; any package manager works. It assumes you can read JavaScript functions, React components, and hooks such as `useState` and `useEffect`. The examples use TypeScript to describe tasks and logs; React's [TypeScript guide](https://react.dev/learn/typescript) explains that syntax. The additional React APIs used to load a run and watch its logger are explained below.

## Create the app

Create a React app with Vite, then add the LightMill packages:

```sh
npm create vite@latest my-experiment -- --template react-ts
cd my-experiment
npm install
npm install @lightmill/react-experiment @lightmill/log-client @lightmill/counterbalancing
npm install --save-dev @lightmill/log-server
```

- `@lightmill/react-experiment` shows the tasks of a timeline.
- `@lightmill/log-client` sends logs to the server.
- `@lightmill/counterbalancing` decides which condition each participant sees first.
- `@lightmill/log-server` is the server. It runs on its own; installing it in the app is only a convenience for this tutorial.

Delete `src/App.css` and `src/index.css`, and remove the `import './index.css'` line from `src/main.tsx`.

## Describe the tasks and the logs

An experiment is a timeline of tasks. A task is any object with a `type`, plus whatever the task needs. A log records what happened during a task. Logs have a `type` too, and their other values end up as columns in the CSV file.

Create `src/experiment.ts`:

```ts
import { latinSquare } from '@lightmill/counterbalancing';

export type Size = 'small' | 'large';

export type Task =
  { type: 'intro'; id: string } | { type: 'trial'; id: string; size: Size };

export type Log =
  | { type: 'intro'; taskId: string }
  | { type: 'trial'; taskId: string; size: Size; reactionTime: number };

declare module '@lightmill/react-experiment' {
  interface RegisterExperiment {
    task: Task;
    log: Log;
  }
}

const trialsPerBlock = 5;

export function createTimeline(participantNumber: number): Task[] {
  const orders = latinSquare<Size>(['small', 'large']);
  const order = orders[participantNumber % orders.length];
  const timeline: Task[] = [{ type: 'intro', id: 'intro' }];
  for (const size of order) {
    for (let i = 0; i < trialsPerBlock; i++) {
      timeline.push({ type: 'trial', id: `${size}-${i}`, size });
    }
  }
  return timeline;
}
```

Every task logs once, when it completes, with its id in `taskId`. That is what lets a participant resume after a reload: the server identifies the last saved completion log with no earlier log missing, and the app skips every task up to the one it names.

The `declare module` block tells `@lightmill/react-experiment` about your tasks and logs, so its hooks are typed.

`latinSquare` returns one condition order per row of a latin square. With two conditions, that is `small` then `large`, and `large` then `small`. Participant 1 gets the second order, participant 2 the first, and so on. The timeline depends only on the participant number, so the app can rebuild the same one when the participant comes back.

## Write the task components

Each task type has a component. `useTask` gives it the current task and a function to call when the task is done. `useLogger` gives it a function that sends a log.

Create `src/tasks.tsx`:

```tsx
import { useLogger, useTask } from '@lightmill/react-experiment';
import { useEffect, useState } from 'react';

export function Intro() {
  const { task, onTaskCompleted } = useTask('intro');
  const log = useLogger('intro');
  return (
    <div>
      <p>Click the button as soon as it appears.</p>
      <button
        onClick={() => {
          log({ taskId: task.id });
          onTaskCompleted();
        }}
      >
        Start
      </button>
    </div>
  );
}

export function Trial() {
  const { task, onTaskCompleted } = useTask('trial');
  const log = useLogger('trial');
  const [shownAt, setShownAt] = useState<number | null>(null);

  useEffect(() => {
    const delay = 500 + Math.random() * 1500;
    const timeout = setTimeout(() => setShownAt(performance.now()), delay);
    return () => clearTimeout(timeout);
  }, []);

  if (shownAt == null) return <p>Get ready…</p>;
  return (
    <button
      style={{ fontSize: task.size === 'small' ? '0.8rem' : '2rem' }}
      onClick={() => {
        const reactionTime = performance.now() - shownAt;
        log({ taskId: task.id, size: task.size, reactionTime });
        onTaskCompleted();
      }}
    >
      Click
    </button>
  );
}
```

Each task mounts fresh, even when the previous task used the same component, so `shownAt` starts over at every trial.

`useLogger` does not wait for the server. Logs are sent in the background, in batches, and retried if the network fails. Finishing a task and saving its log are separate events: unsaved logs stay in page memory and are lost if the page closes or reloads. A resumed run may repeat those tasks. The app below offers a retry and a download before participants leave.

## Play the tasks locally

Before connecting the server, check the task components on their own. Replace `src/App.tsx`:

```tsx
import { TimelinePlayer } from '@lightmill/react-experiment';
import { createTimeline } from './experiment.ts';
import { Intro, Trial } from './tasks.tsx';

const timeline = createTimeline(1);

export default function App() {
  return (
    <TimelinePlayer
      timeline={timeline}
      onLog={async (log) => {
        console.log(log);
      }}
      elements={{
        tasks: { intro: <Intro />, trial: <Trial /> },
        completed: <p>All ten trials are done.</p>,
      }}
    />
  );
}
```

In the app directory, start Vite:

```sh
npm run dev
```

Open <http://localhost:5173/>. You should see the instructions, then ten trials, then the completion message. Logs appear in the browser's developer console only; this version saves no data and starts over when you reload. Stop Vite with Ctrl+C before starting the log server in this terminal.

## Start the log server

The server needs two secrets. Put them in a `.env` file at the root of the app. Add `.env` and `data.sqlite` to `.gitignore`, so neither secrets nor participant data go into version control:

```sh
SESSION_KEY=change-me-to-a-long-random-string
HOST_PASSWORD=change-me-too
```

`SESSION_KEY` signs the cookies that identify participants. `HOST_PASSWORD` protects the host account, which can read every log.

Create the database, then create the experiment. The client never creates experiments: a participant can only join one that exists.

```sh
npx log-server migrate
npx log-server experiment add reaction-time
```

Both commands use `./data.sqlite` by default. Start the server:

```sh
npx log-server start --same-site --allowed-origin http://localhost:5173
```

The server listens on port 3000. `--allowed-origin` lets the page served by Vite on port 5173 call it. `--same-site` tells the server that the page and the server are on the same site, which lets cookies work over plain HTTP. The port doesn't count, so `localhost:5173` and `localhost:3000` are on the same site, but `localhost` and `127.0.0.1` are not: open the app on `localhost`.

The server warns that cookies are only secure over HTTPS. That is expected here. [Deploying](deploying.md) covers HTTPS.

Leave the server running and open another terminal for the rest of the tutorial.

## Wire it together

The complete `src/App.tsx` below adds server logging and resuming to the local player. It has four parts.

### Start or resume a run

`startRun` reads the saved progress for the participant number in the URL. It returns a logger, the timeline, and the id of the last saved task. The timeline is built once for this run; rebuilding it on every render would make `TimelinePlayer` throw.

The `run` promise is also created once, outside the React components. This keeps React's development mode from starting a second run when it renders a component again. Without a positive participant number, no run starts.

### Show the run and watch saving

React's [`use`](https://react.dev/reference/react/use) reads the result of the `run` promise. While it is waiting, [`Suspense`](https://react.dev/reference/react/Suspense) shows "Loading…". Once it resolves, `Experiment` shows the timeline.

[`useSyncExternalStore`](https://react.dev/reference/react/useSyncExternalStore) subscribes to the logger, so the screen updates when delivery changes. `onCompleted` means the timeline has ended, but its last answers may still be on their way. The effect waits for the logger's `idle` state, then calls `completeRun`. Only a successful completion shows "Thank you!".

### Handle a saving failure

`onLog` gives each task's log to `logger.addLog`. The logger sends logs in the background and retries failures. Participants can continue during those retries. If the logger pauses, `paused` lets the current task finish, then shows the retry and download screen before another task is displayed. Calling `retry` starts sending again and lets the player continue.

The `onLog` handler catches a rejection caused by a pause because the logger still holds those answers for retry. It rethrows other failures. Keep the page open while retrying; the download preserves a separate copy for the researcher.

### Show errors and confirm before leaving

An error boundary displays a message if loading the run or playing the timeline fails. `useConfirmBeforeUnload` asks the browser to confirm before leaving while the logger is still running. That confirmation does not save answers and cannot prevent every browser or device from closing the page.

### Complete app

Replace the local player in `src/App.tsx` with this file. Keep `src/experiment.ts` and `src/tasks.tsx` as they are:

```tsx
import { Client, type Logger } from '@lightmill/log-client';
import {
  TimelinePlayer,
  useConfirmBeforeUnload,
} from '@lightmill/react-experiment';
import {
  Component,
  Suspense,
  use,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { createTimeline, type Log, type Task } from './experiment.ts';
import { Intro, Trial } from './tasks.tsx';

const client = new Client<Log>({ apiRoot: 'http://localhost:3000' });

async function startRun(participantNumber: number) {
  const experimentName = 'reaction-time';
  const runName = `participant-${participantNumber}`;
  const [resumable] = await client.getResumableRuns({
    experimentName,
    runName,
    resumableLogTypes: ['intro', 'trial'],
  });
  const logger =
    resumable == null
      ? await client.startRun({ experimentName, runName })
      : await client.startRun({
          runId: resumable.run.id,
          after: resumable.toResumeAfter,
        });
  return {
    logger,
    timeline: createTimeline(participantNumber),
    lastTaskId: resumable?.toResumeAfter.log?.taskId,
  };
}

const participant = Number(
  new URLSearchParams(location.search).get('participant'),
);
const run =
  Number.isInteger(participant) && participant > 0
    ? startRun(participant)
    : null;

export default function App() {
  if (run == null) return <p>Add ?participant=&lt;number&gt; to the URL.</p>;
  return (
    <ErrorBoundary>
      <Suspense fallback={<p>Loading…</p>}>
        <Experiment run={run} />
      </Suspense>
    </ErrorBoundary>
  );
}

function Experiment({ run }: { run: ReturnType<typeof startRun> }) {
  const { logger, timeline, lastTaskId } = use(run);
  const state = useSyncExternalStore(logger.subscribe, () => logger.state);
  const [timelineCompleted, setTimelineCompleted] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // completeRun() rejects while logs are held, so wait until every log is
  // stored, even after a pause.
  useEffect(() => {
    if (timelineCompleted && state.status === 'idle') {
      logger.completeRun().catch(setError);
    }
  }, [logger, timelineCompleted, state.status]);

  const loggerStopped = ['completed', 'canceled', 'interrupted'].includes(
    state.status,
  );
  useConfirmBeforeUnload(!loggerStopped);

  if (error != null) throw error;
  if (state.status === 'completed') return <p>Thank you!</p>;
  return (
    <TimelinePlayer
      timeline={timeline}
      resumeAfterTask={
        lastTaskId == null ? undefined : (task: Task) => task.id === lastTaskId
      }
      // A rejected onLog throws in TimelinePlayer. The logger keeps the logs a
      // pause rejects, so only other errors are rethrown.
      onLog={(log) =>
        logger.addLog(log).catch((error) => {
          if (logger.state.status !== 'paused') throw error;
        })
      }
      onCompleted={() => setTimelineCompleted(true)}
      paused={state.status === 'paused'}
      elements={{
        tasks: { intro: <Intro />, trial: <Trial /> },
        completed: <p>Saving…</p>,
        paused: <Paused logger={logger} />,
      }}
    />
  );
}

function Paused({ logger }: { logger: Logger<Log> }) {
  return (
    <div>
      <p>
        Your answers could not be saved. Keep this page open and check your
        connection. Download a copy before leaving if retrying does not work.
      </p>
      <button onClick={() => logger.retry().catch(() => {})}>Try again</button>
      <button onClick={() => downloadUnsavedLogs(logger)}>
        Download unsaved answers
      </button>
    </div>
  );
}

function downloadUnsavedLogs(logger: Logger<Log>) {
  const file = new Blob([JSON.stringify(logger.inFlightLogs, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'unsaved-answers.json';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error != null) {
      return <p>Something went wrong. Please contact the researcher.</p>;
    }
    return this.props.children;
  }
}
```

Here is what happens when a participant opens the page:

1. The app reads the participant number from the URL, for example `?participant=3`, and names the run after it. A run is one participant going through the experiment once.
2. `getResumableRuns` asks the server whether this browser already started this run. If it did, `startRun` resumes it after the last saved completion log. Otherwise, `startRun` creates it.
3. While this happens, `use` suspends the component and `Suspense` shows "Loading…". The promise is created once, outside of React, so React's development mode, which renders components twice, does not start two runs.
4. `TimelinePlayer` shows the task components in turn. When resuming, `resumeAfterTask` skips every task up to the last one logged.
5. Every log goes to `logger.addLog`. If the server can't be reached for a while, the logger pauses and keeps the logs. `paused` then makes `TimelinePlayer` show the `Paused` screen once the current task ends, and `retry()` sends the logs again.
6. When the timeline ends, `TimelinePlayer` calls `onCompleted` and shows "Saving…". Once every log is stored, `completeRun` tells the server the run is complete, and the app thanks the participant.
7. Until the logger stops, `useConfirmBeforeUnload` asks the browser to confirm before the participant leaves the page.
8. If anything else fails, the error boundary shows a message instead of a blank page. This includes a participant who comes back after completing the experiment, or who opens it in another browser: the run name is taken, and `startRun` fails with a `RUN_EXISTS` error.

## Try it

Start the app:

```sh
npm run dev
```

Open <http://localhost:5173/?participant=1> and do a few trials. Reload the page: the experiment continues after the last trial whose completion log was saved. If an answer had not reached the server, that trial repeats. Finish the experiment and wait for "Thank you!", which appears only after saving and completing the run.

If the app shows the saving failure screen, keep the page open and retry. The download button saves a copy of unsaved answers for the researcher; it does not upload them or complete the run. The server has no automatic import for that file. [Resuming runs](resuming-runs.md#limits) explains the recovery limits.

## Get the data

Export every log as CSV:

```sh
npx log-server export > logs.csv
```

```csv
type,experiment_name,run_name,run_status,date,reaction_time,size,task_id
intro,reaction-time,participant-1,completed,2026-10-06T19:18:01.485Z,,,intro
trial,reaction-time,participant-1,completed,2026-10-06T19:18:03.411Z,101.59999999403954,large,large-0
trial,reaction-time,participant-1,completed,2026-10-06T19:18:05.487Z,87.20000000298023,large,large-1
…
```

There is one row per log. The first columns say where the log comes from, and the others are its values, with names converted to snake case. `date` is added by the client when the log is created. [Exporting data](exporting-data.md) explains the format, the filters, and how to export from a running server.

## Next steps

- [Deploying](deploying.md): put the server and the app online.
- [Resuming runs](resuming-runs.md): what resuming does, and its limits.
- [`@lightmill/react-experiment`](../../packages/react-experiment/README.md): everything `TimelinePlayer` can do.
- [`@lightmill/log-client`](../../packages/log-client/README.md): how the logger sends logs and handles failures.
