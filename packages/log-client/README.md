# @lightmill/log-client

Browser/client SDK for the Lightmill log server.

This package helps you:

1. Discover resumable runs for a participant session.
2. Start or resume runs.
3. Send logs in batches and reliably flush before completion.

## Install

```sh
npm install @lightmill/log-client
```

## Usage

```ts
import { Client } from '@lightmill/log-client';

type MyLog =
  | { type: 'trial-start'; trialId: string }
  | { type: 'trial-end'; trialId: string; durationMs: number };

const client = new Client<MyLog>({ apiRoot: 'https://example.com/api' });

const logger = await client.startRun({
  experimentName: 'pointing-study',
  runName: 'participant-42',
});

await logger.addLog({ type: 'trial-start', trialId: '1' });
await logger.addLog({ type: 'trial-end', trialId: '1', durationMs: 812 });
await logger.completeRun();
```

Before calling `startRun`, create `pointing-study` on the server. See
[create an experiment before the first run](../log-server/README.md#create-an-experiment-before-the-first-run).

## API Reference

### `class Client<Log>`

Exported as `Client` (implemented by `LightmillClient`).

| Method                                                                      | Description                                                       |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `new Client({ apiRoot, serializeLog?, requestThrottle?, requestTimeout? })` | Create a client bound to an API root.                             |
| `getResumableRuns({ resumableLogTypes, experimentName?, runName? })`        | Fetch current-session runs that can resume from a known log type. |
| `startRun(options)`                                                         | Start a new run or resume an existing one, returns a logger.      |
| `logout()`                                                                  | Delete current session on the server.                             |

### `Logger` type

Returned by `startRun(...)`.

Main operations:

- `addLog(log)`
- `flush()`
- `completeRun()`
- `cancelRun({ discardInFlightLogs? })`
- `interruptRun({ discardInFlightLogs? })`
- `retry()`
- `state`, `subscribe(listener)`
- `inFlightLogs`

## Failures

The logger retries a batch that fails with a network error, a timeout, a 5xx,
a `408` or a `429` (waiting for `Retry-After`), for up to 2 minutes. A request
times out after `requestTimeout.base` milliseconds (default `10000`) plus
`requestTimeout.perKilobyte` milliseconds per kilobyte sent (default `100`). A batch
rejected with `413` is resent in halves.

When retries run out, or the server answers with another error, the logger
pauses. It never drops logs on its own:

- the failed batch's `addLog()` promises reject;
- every other in-flight log is held, its `addLog()` promise pending;
- `logger.inFlightLogs` lists the logs not stored yet, e.g. to offer a download;
- `logger.retry()` sends them again, and resolves once they are stored;
- `flush()` and `completeRun()` reject while logs are held; `cancelRun()` and
  `interruptRun()` too, unless passed `{ discardInFlightLogs: true }`.
- while `completeRun()`, `cancelRun()` or `interruptRun()` ends the run,
  `addLog()` and other calls ending it reject.

`logger.state` reports delivery: `idle`, `sending`, `retrying` (with `error`,
`attempt` and `delayMs`), `paused` (with `error`), or the ended run's status.
It stays the same object until it changes, and `logger.subscribe(listener)`
calls `listener` on each change, so they work with React's
`useSyncExternalStore`:

```ts
const state = useSyncExternalStore(logger.subscribe, () => logger.state);
```

## Notes

- Requests use JSON:API media type `application/vnd.api+json`.
- The logger sends logs in batches through `POST /operations` (JSON:API
  Atomic Operations), one batch at a time: logs added while a batch waits for
  the server go in the next one, up to about 512 kB per batch. `addLog()`
  resolves once its batch is stored.
- `requestThrottle` sets the minimum time in milliseconds between the starts
  of two batches (default `0`). `flush()` sends queued logs at once.
- For non-JSON-compatible values, provide a custom `serializeLog`.
- `flush()` only waits for logs queued before it was called.
- `getResumableRuns()` only finds runs in the browser's current participant
  session. It returns an empty list if that session is gone. The standalone
  server persists sessions; an embedded `LogServer` needs a persistent
  session store to keep them across restarts. See
  [resuming runs after a restart](../log-server/README.md#resuming-runs-after-a-restart)
  for setup and cookie lifetime.
