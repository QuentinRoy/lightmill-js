# Getting started

This tutorial builds a small reaction-time experiment from scratch and collects its data. Each participant clicks a button as soon as it appears, five times with a small button and five times with a large one. Half of the participants start with the small button, the other half with the large one.

By the end, you will have:

- a React app that shows the tasks one after the other,
- a log server that stores what participants do,
- participants who can reload the page and continue after their saved progress,
- a CSV file with the results.

You need Node.js 24.12 or later and a terminal. The tutorial uses npm; any package manager works. It assumes you can read JavaScript functions, React components, and hooks such as `useState` and `useEffect`. The examples use TypeScript to describe tasks and logs; React's [TypeScript guide](https://react.dev/learn/typescript) explains that syntax. The `Run` component, which starts the run and sends its logs, is explained below.

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

Every task logs once, when it completes, with its id in `taskId`. That is what lets a participant resume after a reload: the server finds the run's last log of one of these types, and the app skips every task up to the one it names.

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

`useLogger` does not wait for the server. Logs are sent in the background, in batches, and retried if the network fails. Until they reach the server, they only exist in the page, so the app below offers a retry and a download when saving fails.

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

`Run` is the component that runs one run of the experiment. You give it the log client, the experiment and run names, and your task components. It does the rest:

- finds out whether the participant has a run in progress, and asks before resuming it,
- builds the timeline and skips the tasks already done,
- sends the logs to the server and completes the run once every log is stored,
- shows a screen while it loads, when saving fails, when something goes wrong, and when the run is complete,
- asks the browser to confirm before the page closes.

Each screen is an element you pass in `elements`. Every screen except the tasks has a small, unstyled default, so the complete app below only overrides the three screens whose text matters here: the one for a saving failure (`paused`), the one for an error (`error`), and the final one (`completed`). [Write your own screens](#write-your-own-screens) shows the code of every default.

Replace the local player in `src/App.tsx` with this file. Keep `src/experiment.ts` and `src/tasks.tsx` as they are:

```tsx
import { Client, RequestError } from '@lightmill/log-client';
import {
  resumeAfter,
  Run,
  useLogDelivery,
  useRunError,
} from '@lightmill/react-experiment';
import { useEffect } from 'react';
import { createTimeline, type Log } from './experiment.ts';
import { Intro, Trial } from './tasks.tsx';

// Create the client once, outside of components.
const client = new Client<Log>({ apiRoot: 'http://localhost:3000' });

const participant = Number(
  new URLSearchParams(location.search).get('participant'),
);

export default function App() {
  if (!Number.isInteger(participant) || participant <= 0) {
    return <p>Add ?participant=&lt;number&gt; to the URL.</p>;
  }
  return (
    <Run
      client={client}
      experimentName="reaction-time"
      runName={`participant-${participant}`}
      resumableLogTypes={['intro', 'trial']}
      timeline={({ resumeLog }) => {
        const timeline = createTimeline(participant);
        return resumeLog == null
          ? timeline
          : resumeAfter(timeline, (task) => task.id === resumeLog.taskId);
      }}
      elements={{
        tasks: { intro: <Intro />, trial: <Trial /> },
        paused: (
          <div>
            <p>Your answers could not be saved. Check your connection.</p>
            <Recovery />
          </div>
        ),
        error: <Failed />,
        completed: <p>Thank you!</p>,
      }}
    />
  );
}

function Failed() {
  const { error } = useRunError();
  useEffect(() => {
    // Run does not report errors. Send yours to your own monitoring here.
    console.error('The run failed:', error);
  }, [error]);
  return (
    <div>
      <p>{messageFor(error)}</p>
      <Recovery />
    </div>
  );
}

function messageFor(error: unknown) {
  if (error instanceof RequestError && error.code === 'RUN_EXISTS') {
    return 'This participant number has already been used. If you have not finished, return to the original browser or contact the researcher.';
  }
  if (error instanceof RequestError && error.code === 'ONGOING_RUNS') {
    return 'This browser has an unfinished experiment. Return to its original participant link or contact the researcher.';
  }
  return 'Something went wrong. Please contact the researcher.';
}

// Shows when answers have not reached the server.
function Recovery() {
  const { error, inFlightLogs, retry } = useLogDelivery();
  if (inFlightLogs.length === 0) return null;
  const href =
    'data:application/json;charset=utf-8,' +
    encodeURIComponent(JSON.stringify(inFlightLogs, null, 2));
  return (
    <div>
      <p>{inFlightLogs.length} answers are not saved yet.</p>
      <a download="unsaved-answers.json" href={href}>
        Download unsaved answers
      </a>
      {error != null && <button onClick={() => void retry()}>Try again</button>}
    </div>
  );
}
```

Here is what happens when a participant opens the page:

1. The app reads the participant number from the URL, for example `?participant=3`, and names the run after it. A run is one participant going through the experiment once.
2. `Run` asks the server whether this browser already started this run. While it waits, it shows "Loading…".
3. If it did, `Run` shows "You have a session in progress." with a Resume button, and resumes the run once the participant clicks it. Otherwise, `Run` starts a new run. React's development mode renders components twice, but `Run` starts or resumes the run only once.
4. `Run` calls the `timeline` function once, with `resumeLog`: the last log whose type is in `resumableLogTypes`, or `null` for a new run. When resuming, `resumeAfter` skips every task up to the one the log names.
5. The task components log with `useLogger`. `Run` sends the logs to the server in the background. If the server can't be reached for a while, `Run` shows the `paused` element once the current task ends. `Recovery` offers to download the answers the server does not have, and a button to send them again.
6. When the timeline ends, `Run` shows "Loading…" until every log is stored and the server has the run completed. Then it shows `completed`.
7. Until the run ends, `Run` asks the browser to confirm before the participant leaves the page.
8. If the run can't start or crashes, `Run` shows the `error` element. This includes a participant who comes back after completing the experiment, or who opens it in another browser: the run name is taken, and the server refuses it with a `RUN_EXISTS` error. After a crash, `Run` interrupts the run, so reloading the page offers to resume it.

`Run` never resumes on its own, and never cancels a run: a second tab could otherwise cancel the first tab's logs. Canceling a run is up to the host: see [Deploying](deploying.md#cancel-a-run).

### What to keep in mind

- **Create the client once**, outside of components. A new client is a new run, so a client created while rendering would look up and start the run again at every render.
- **Keep `Run` mounted until the run ends.** If it unmounts earlier, the run stays ongoing, the page is no longer protected against closing, and a paused logger has no screen.
- **Keep your loading text neutral.** `elements.loading` also shows while the run is being saved, not only while it starts. "Please wait…" suits both; "Starting the experiment…" does not.
- **Do not let the paused element throw.** It shows while logs are held. If it throws, the run goes to the `error` element.
- **An overriding `paused` or `error` element owns recovery.** The defaults have a download link and a retry button. An element that skips `useLogDelivery` takes that way to keep the logs away from participants.
- **Report errors yourself.** `Run` has no `onError` prop. Pass `onCaughtError` to React's `createRoot` to hear about crashes while the tasks play, or call your reporting function in an effect in your `error` element, as `Failed` does. Only the effect sees a failure to start, because nothing is thrown then.
- **Check error codes with `RequestError.code`.** The error in the `error` element is whatever was thrown, unchanged. `Failed` uses `instanceof RequestError` to read `RUN_EXISTS` and `ONGOING_RUNS`.
- **Rethrow to use your own error boundary.** An `error` element that throws `useRunError().error` sends the error to the boundary above `Run`:

  ```tsx
  function Rethrow(): never {
    throw useRunError().error;
  }
  ```

## Try it

Start the app:

```sh
npm run dev
```

Open <http://localhost:5173/?participant=1> and do a few trials. Reload the page: you are asked to resume, and the experiment continues after the last trial whose log reached the server. If an answer had not reached the server, that trial repeats. Finish the experiment and wait for "Thank you!", which appears only after saving and completing the run.

If the app shows the saving failure screen, keep the page open and retry. The download link saves a copy of unsaved answers for the researcher; it does not upload them or complete the run. The server has no automatic import for that file. [Resuming runs](resuming-runs.md#limits) explains the recovery limits.

If something doesn't work, see [Troubleshooting](troubleshooting.md).

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

## Write your own screens

The defaults of `Run` are plain on purpose: unstyled, in English, and not configurable. Build your own screens rather than customizing them. Each default is a few lines of code on top of three hooks, copied below. Paste the ones you want, and change their text and markup.

- `useResumeRun()` is for `elements.resume`. It returns `{ resume, run, lastLog }`: a function to resume the run, the run found on the server, and its last resumable log (`null` when none was logged yet).
- `useLogDelivery()` works in every element of `Run`, including `elements.error` when the run never started. It returns `{ error, inFlightLogs, retry }`: why delivery is paused (`null` when it is not), the logs the server has not stored, and a function to send them again. `retry` never rejects and does nothing outside a pause, so you can use it as is in a click handler.
- `useRunError()` is for `elements.error`. It returns `{ error }`: the value that was thrown, unchanged.

These hooks only work in elements that `Run` renders.

### Loading

```tsx
const loading = <p>Loading…</p>;
```

Pass it as `elements.loading`. Remember that it also shows while the run is being saved.

### Resume

```tsx
import { useResumeRun } from '@lightmill/react-experiment';

function Resume() {
  const { resume } = useResumeRun();
  return (
    <>
      <p>You have a session in progress.</p>
      <button type="button" onClick={resume}>
        Resume
      </button>
    </>
  );
}
```

`Run` shows it even when nothing was logged yet, so a resumed run is always explicit. `run` and `lastLog` let you say more, for example which task the participant reached.

### Paused

The paused and error screens share a link to download the logs the server has not stored, and one button to send them again:

```tsx
import { useLogDelivery } from '@lightmill/react-experiment';

function DownloadLogs() {
  const { inFlightLogs } = useLogDelivery();
  if (inFlightLogs.length === 0) return null;
  const href =
    'data:application/json;charset=utf-8,' +
    encodeURIComponent(JSON.stringify(inFlightLogs, null, 2));
  return (
    <a download="logs.json" href={href}>
      Download the logs that were not saved
    </a>
  );
}

function RetryButton() {
  const { retry } = useLogDelivery();
  return <button onClick={() => void retry()}>Retry</button>;
}

function Paused() {
  return (
    <div>
      <p>
        Your progress could not be saved. Check your connection, then retry.
      </p>
      <DownloadLogs />
      <RetryButton />
    </div>
  );
}
```

The link is a plain anchor. It has no side effect while rendering, and it works over http. If your logs hold values JSON can't write, such as a `bigint`, change how they are serialized.

### Error

```tsx
import { RequestError } from '@lightmill/log-client';
import { useLogDelivery, useRunError } from '@lightmill/react-experiment';

// The names you pass to Run.
const experimentName = 'reaction-time';
const runName = 'participant-1';

function Failed() {
  const { error } = useRunError();
  const { error: deliveryError } = useLogDelivery();
  return (
    <div>
      <p>{messageFor(error)}</p>
      <details>
        <summary>Details for the experimenter</summary>
        <pre>{formatDetails(error)}</pre>
      </details>
      <DownloadLogs />
      {deliveryError != null && <RetryButton />}
    </div>
  );
}

function messageFor(error: unknown) {
  if (error instanceof RequestError && error.code === 'RUN_EXISTS') {
    return 'A session with this name already exists. It may already be running on this device.';
  }
  if (error instanceof RequestError && error.code === 'ONGOING_RUNS') {
    return 'You already have a session in progress, perhaps in another tab or on another device.';
  }
  return 'The experiment could not continue because of an unexpected error. Contact the experimenter and give them the details below.';
}

function formatDetails(error: unknown) {
  const lines = [`Experiment: ${experimentName}`, `Run: ${runName}`];
  if (error instanceof RequestError) {
    if (error.code != null) lines.push(`Code: ${error.code}`);
    lines.push(`Status: ${error.status}`);
  }
  lines.push('', describe(error));
  let cause = error instanceof Error ? error.cause : undefined;
  // A chain of causes can be long: stop after five.
  for (let depth = 0; cause != null && depth < 5; depth++) {
    lines.push('', 'Caused by:', describe(cause));
    cause = cause instanceof Error ? cause.cause : undefined;
  }
  return lines.join('\n');
}

// Not every browser puts the message in the stack.
function describe(error: unknown) {
  const text = String(error);
  if (!(error instanceof Error) || !error.stack) return text;
  return error.stack.includes(text) ? error.stack : `${text}\n${error.stack}`;
}
```

The text tells the participant to contact the experimenter and does not say to reload: a reload would lose the logs the page still holds. The details give the experimenter something to act on. The retry button shows only when delivery is paused, which happens when the crash left logs the server refused to take.

### Completed

```tsx
const completed = <p>Thank you, the experiment is complete.</p>;
```

`Run` shows it only once the server has the run completed, so "thank you" means the data is saved.

### Put them together

```tsx
<Run
  // …
  elements={{
    tasks: { intro: <Intro />, trial: <Trial /> },
    loading,
    resume: <Resume />,
    paused: <Paused />,
    error: <Failed />,
    completed,
  }}
/>
```

## Next steps

- [Deploying](deploying.md): put the server and the app online.
- [Resuming runs](resuming-runs.md): what resuming does, and its limits.
- [`@lightmill/react-experiment`](../../packages/react-experiment/README.md): everything `Run` and `TimelinePlayer` can do.
- [`@lightmill/log-client`](../../packages/log-client/README.md): how the logger sends logs and handles failures.
