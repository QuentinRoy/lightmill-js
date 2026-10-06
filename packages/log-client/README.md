# @lightmill/log-client

Send an experiment's logs from the browser to a [LightMill log server](../log-server/README.md).

The client starts and resumes runs, and gives you a logger for each. The logger numbers your logs, sends them in batches, retries when the network fails, and never drops a log on its own. It works with any interface; [`@lightmill/react-experiment`](../react-experiment/README.md) connects it to React.

## Install

```sh
npm install @lightmill/log-client
```

It supports Chrome and Edge 85, Firefox 90, and Safari 15 (macOS and iOS) or later.

## Example

```ts
import { Client } from '@lightmill/log-client';

type Log =
  | { type: 'trial-start'; trialId: string }
  | { type: 'trial-end'; trialId: string; durationMs: number };

const client = new Client<Log>({ apiRoot: 'https://study.example.org/api' });

const logger = await client.startRun({
  experimentName: 'pointing-study',
  runName: 'participant-42',
});

await logger.addLog({ type: 'trial-start', trialId: '1' });
await logger.addLog({ type: 'trial-end', trialId: '1', durationMs: 812 });
await logger.completeRun();
```

The experiment must exist on the server: the client never creates one. See [creating an experiment](../log-server/README.md#log-server-experiment-add-name).

The session that identifies the participant is a cookie, so the server must accept the page's origin, and the cookie must be allowed by the browser. [Deploying](../../docs/guides/deploying.md) explains which server options to use.

## Runs

A run is one participant going through the experiment once. Start a new one with `startRun({ experimentName, runName })`. The run name identifies the participant within the experiment: a run name already used by a run that isn't canceled makes `startRun` reject, with an error whose `code` is `RUN_EXISTS`. The name is optional; without it, only `getResumableRuns` can find the run again.

Resume a run with `startRun({ runId, after })` or `startRun({ experimentName, runName, after })`. `after` is `{ number }`, the log number to resume after: the server cancels every later log, and the new logs continue from there. `getResumableRuns` finds the runs to resume and the log to resume after. [Resuming runs](../../docs/guides/resuming-runs.md) shows the whole process.

End a run with one of three calls:

- `completeRun()` when the participant finished.
- `interruptRun()` when the participant stops for now and may come back. An interrupted run can be resumed.
- `cancelRun()` when the run should not count. Its name becomes free again, and the CSV export leaves it out.

Each first sends the logs not sent yet, and rejects if it can't. Once a run has ended, its logger accepts no more logs.

## Logs

A log is an object with a `type` and any other values:

```ts
logger.addLog({ type: 'trial-end', trialId: '1', durationMs: 812 });
```

- Every log gets a `date`, the time `addLog` was called, unless it has one already.
- Values can be JSON values or `Date`s, nested in objects and arrays. Dates are sent as ISO 8601 strings, and `undefined` properties are left out.
- For other values, such as a `bigint` or a `Map`, give the client a `serializeLog` function that turns a log's values, without its `type`, into JSON. TypeScript requires it when your log type has such values.

  ```ts
  type Log = { type: 'count'; total: bigint };

  const client = new Client<Log>({
    apiRoot: 'https://study.example.org/api',
    serializeLog: ({ date, total }) => ({
      date: date.toISOString(),
      total: total.toString(),
    }),
  });
  ```

- The logger numbers logs in the order you add them, starting after the last log of the run.

## Delivery

`addLog` queues the log and returns a promise that resolves once the server has stored it. You don't have to wait for it, but catch its rejection: the logger keeps the log either way, and `completeRun()` won't complete the run until it is stored. The logger sends one batch at a time: logs added while a batch is on its way go in the next one, up to about 512 kB per batch. `requestThrottle` sets a minimum time between the starts of two batches.

`flush()` sends the queued logs at once, and resolves when every log added before the call is stored. It then checks that the server has no gap in the run's logs, and rejects if one is missing.

### When the network fails

The logger sends a batch again after a network error, a timeout, a `5xx`, a `408`, or a `429` (waiting as long as `Retry-After` asks), for up to two minutes. A request times out after `requestTimeout.base` milliseconds (10,000 by default), plus `requestTimeout.perKilobyte` milliseconds per kilobyte sent (100 by default). A batch the server refuses as too large (`413`) is sent again in halves.

When retries run out, or the server refuses a batch for another reason, the logger pauses. It never drops logs on its own:

- the `addLog` promises of the failed batch reject;
- every other log not stored yet is held, and its `addLog` promise stays pending;
- `logger.inFlightLogs` lists the logs not stored yet, for example to let the participant download them;
- `logger.retry()` sends them again, with a fresh two minutes, and resolves once they are stored;
- `flush()` and `completeRun()` reject while logs are held, and so do `cancelRun()` and `interruptRun()`, unless they get `{ discardInFlightLogs: true }`. Discarding aborts a batch on its way, but the server may have stored it already.

### State

`logger.state` says how delivery is going:

| `status`                               | Meaning                                                                             |
| -------------------------------------- | ----------------------------------------------------------------------------------- |
| `idle`                                 | Every log is stored.                                                                |
| `sending`                              | A batch is on its way.                                                              |
| `retrying`                             | The last attempt failed and will be retried. Has `error`, `attempt`, and `delayMs`. |
| `paused`                               | Retries ran out. Logs are held until `retry()`. Has `error`.                        |
| `completed`, `canceled`, `interrupted` | The run has ended.                                                                  |

Only log batches count: retries while `flush()` checks for gaps, or while a call ends the run, only show in that call's promise.

`logger.subscribe(listener)` calls `listener` with the new state on each change, and returns a function that stops it. `state` stays the same object until it changes, so both work with React's `useSyncExternalStore`. Without React:

```ts
logger.subscribe((state) => {
  retryButton.hidden = state.status !== 'paused';
});
retryButton.onclick = () => logger.retry().catch(() => {});
```

[`@lightmill/react-experiment`](../react-experiment/README.md#handling-log-delivery-failures) shows how to stop a timeline while the logger is paused.

## API

### `new Client<Log>(options)`

| Option            | Description                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------ |
| `apiRoot`         | URL of the log server, such as `https://study.example.org/api`.                                        |
| `serializeLog`    | Turns a log's values into JSON. See [Logs](#logs).                                                     |
| `requestThrottle` | Minimum time in milliseconds between the starts of two batches. Defaults to `0`. `flush()` ignores it. |
| `requestTimeout`  | `{ base, perKilobyte }`, in milliseconds. Defaults to `{ base: 10000, perKilobyte: 100 }`.             |

`Log` is the union of your log types.

### `client.startRun(options)`

Starts or resumes a run, and resolves with its logger. `options` is one of:

- `{ experimentName, runName? }` to start a new run;
- `{ experimentName, runName, after }` to resume a run by name;
- `{ runId, after }` to resume a run by id.

### `client.getResumableRuns({ resumableLogTypes, experimentName?, runName? })`

Lists the runs the current browser session started that are running or interrupted, optionally filtered by experiment and run name. Each result is `{ run, experiment, toResumeAfter }`:

- `run` is `{ id, name, status }`, `experiment` is `{ id, name }`;
- `toResumeAfter` is the last log of the run whose type is in `resumableLogTypes`, as `{ number, log }`, or `{ number: 0, log: null }` when there is none. Pass it as `after` to `startRun`.

Without a session, it resolves with an empty list.

### `client.logout()`

Ends the session on the server. The browser can no longer find its runs.

### Logger

| Member                                   | Description                                                                            |
| ---------------------------------------- | -------------------------------------------------------------------------------------- |
| `addLog(log)`                            | Queues a log. Resolves once it is stored. Rejects once the run is ending or has ended. |
| `flush()`                                | Sends queued logs at once. Resolves once every log added before is stored.             |
| `retry()`                                | Sends held logs again. Does nothing unless paused.                                     |
| `completeRun()`                          | Flushes, then completes the run.                                                       |
| `interruptRun({ discardInFlightLogs? })` | Flushes, or discards, then interrupts the run.                                         |
| `cancelRun({ discardInFlightLogs? })`    | Flushes, or discards, then cancels the run.                                            |
| `state`                                  | Delivery state. See [State](#state).                                                   |
| `subscribe(listener)`                    | Calls `listener` on each state change. Returns an unsubscribe function.                |
| `inFlightLogs`                           | Logs not stored yet, whether queued, on their way, or held.                            |

Only one call can end the run: while one is in progress, another rejects, and so does `addLog`.

### Types

`Logger`, `LoggerState`, `RequestTimeout`, and `LogValuesSerializer` are exported for TypeScript.

### Errors

A request the server refuses rejects with an error that has the HTTP `status` and the server's error `code`, such as `RUN_EXISTS`. `startRun` rejects with a plain error when the experiment does not exist.
