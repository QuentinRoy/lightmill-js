# What `Logger.retry()` does in each logger state

Research for bead `lightmill-js-yqf.10`. Facts only; the design decision belongs to `lightmill-js-yqf.11`.

Source at `main` (`7deca67`). Paths are under `packages/log-client/`. "Probe" means a throwaway vitest file run through `pnpm test` (not committed; scenarios listed at the end). "Inferred" means read from source, not run.

## How `retry()` is built

- `LightmillLogger.retry()` is `await this.#queue.retry()`. It has no logic of its own: no check of the run status, no wrapping of errors (`src/logger.ts:260-262`).
- `DeliveryQueue.retry()` (`src/delivery-queue.ts:260-268`):
  1. Returns at once unless the queue state is `paused` (l. 261).
  2. Reads the last in-flight item's `number`, `last` (l. 262-263). Throws `'A paused queue holds items'` if there is none (l. 264).
  3. Switches the state out of `paused` to `sending` or `idle` synchronously (l. 266, via `#update(#deliveryState())`).
  4. `await this.flushUpTo(last.number)` (l. 267).
- `flushUpTo(number)` (l. 276-294) sets `#flushedNumber` so items up to `number` skip the throttle (l. 278, l. 153), schedules a batch, and resolves when no item numbered `<= number` is in flight (l. 283-285). It rejects with `state.error` if the state is `paused` while some are (l. 286-288). The resolve check comes before the reject check, so resolve wins when both hold.
- There is no retry budget object: the "fresh two minutes" is simply the next `sendWithRetries` call, which starts `firstFailure` unset (`src/send-with-retries.ts:30, 39, 48`; `retryDurationMs = 2 * 60_000`, l. 5).

## Per state

"No-op" = resolves with `undefined` on the next microtask, sends nothing, changes no state.

| State | `retry()` does | Returns / rejects | Evidence |
| --- | --- | --- | --- |
| `idle` | No-op. | Resolves `undefined`. | Guard `delivery-queue.ts:261`. Queue test `delivery-queue.test.ts:289-296`. Probe: no request sent. |
| `sending` | No-op. Does not wait for the batch on its way. | Resolves `undefined` immediately, while `inFlightLogs` is still non-empty. | Guard l. 261. Probe: resolved at once, still 1 POST, 1 log in flight. Queue test l. 289-296 covers "does nothing", not "does not wait". |
| `retrying` | No-op. State and the scheduled attempt are untouched. | Resolves `undefined` immediately. | Guard l. 261 (`retrying` is a distinct status, l. 7, set by `onRetry`, l. 185-186). Probe: resolved at once, 1 POST, `logger.state` same object. |
| `paused` | Moves state to `sending`, resends all held logs now (throttle skipped), with a fresh retry window. | Resolves `undefined` once every log in flight at call time is stored. Rejects with the new pause's `error` if the logger pauses again before. | `delivery-queue.ts:260-268`. Queue tests l. 244-287. Logger test `logger.test.ts:573-614`. |
| `completed` / `canceled` / `interrupted` | No-op. No guard on run status. Does not throw, unlike `addLog` (`logger.ts:152-156`) and `#endRun` (l. 326-330). | Resolves `undefined`. | Inferred: `logger.retry()` reads only the queue state, which is `idle` after a successful end (see below). Probe confirmed all three, no request sent. |

Why the queue is `idle` once the run has ended: `#endRun` either flushes (resolves only with nothing in flight, `logger.ts:339`, `delivery-queue.ts:283-285`) or calls `discard()`, which empties the queue and sets `idle` (l. 310-320). `addLog` is refused from `#ending` onwards (`logger.ts:157-159`). So the queue cannot be `paused` after the run ended. Probe also covered `interruptRun({ discardInFlightLogs: true })` from `paused`, then `retry()`: no-op.

Also: `retry()` while a `completeRun()` is waiting on its `PATCH` (queue idle, `#ending` true) is a no-op (probe).

## Details for `paused`

- **What is resent.** Everything held: the failed batch and any logs added while paused. While paused, new logs are queued but not scheduled (`delivery-queue.ts:146-148`), and `last` (l. 262-263) includes them. Test: `delivery-queue.test.ts:244-259` (sent batches `[[1], [1, 2]]`, both resolve).
- **Batching.** The resend is not limited to the numbers `<= last`: `#takeBatch` (l. 217-228) takes up to the budget from the queue front. Logs added in the same tick as `retry()` (before the scheduled microtask, l. 165-168) share the batch (probe: batch stored `[1, 2]`). If that batch fails, `retry()` rejects.
- **Resolution means "acknowledged", not "verified".** `retry()` does not call `#fetchFirstMissingLogNumber` (compare `flush()`, `logger.ts:264-279`). Inferred from the source; no test asserts it.
- **Old `addLog` promises stay rejected.** Logs of the batch that triggered the pause had their `addLog()` promises rejected at pause time (`delivery-queue.ts:207-209`; `logger.test.ts:585-589`). After `retry()` stores them, those promises do not change: `logger.test.ts:585` vs `:610` (log 1 rejected, then stored). Logs held but not in the failed batch stay pending and resolve on retry (`logger.test.ts:581-583, 608`; `README.md:92-93`).
- **State events.** `paused` to `sending` is emitted synchronously inside the `retry()` call (l. 266). Then `retrying` / `sending` / `idle` / `paused` as for any batch. `README.md:118` says retries of non-log requests are not shown in state.
- **Rejection value.** The raw error of the failed batch, not an `AddLogError` (`logger.ts:260-262` does not wrap; `addLog` does, l. 190-196). Probe: `retry()` rejected with an error whose `status` is 400 / 503.

## Concurrent calls (Inferred, probe confirmed)

The first call leaves `paused` synchronously (l. 266). A second call made while the first is pending sees `sending`/`retrying` and is a no-op: it resolves immediately, before the logs are stored. Only the first promise waits. A call made after the first resolved is a no-op on `idle`. Probe: two calls while paused; second resolved at once with 1 log still in flight, first resolved after the server answered.

Consequence: "`retry()` resolved" does not imply "logs are stored" for any call except the one that left `paused`.

## Logs added while a retry runs

- They are queued behind the held logs and sent after, subject to the throttle (`#flushedNumber` covers only `<= last`, l. 153, `delivery-queue.test.ts:145-161`).
- `retry()` does not wait for them: `delivery-queue.test.ts:261-273` (`inFlight` is `[item(2)]` after `retry()` resolves). Probe confirmed with real logger.
- If a later log's batch fails and pauses the logger after the retried logs were stored, `retry()` still resolves (resolve check first, l. 283-285). Probe: `retry()` resolved, logger then `paused` with the late log held. This applies only if the late log is in a different batch from the retried ones.
- If the late logs are in the same batch as the retried ones and it fails, `retry()` rejects.

## Can it reject for a reason other than the logger pausing again?

Rejection is always `state.error` of a `paused` state (`delivery-queue.ts:286-288`). That is a pause, but not necessarily a repeat of the original network failure. The pause error can be any batch failure (`logger.ts:202-246`, `delivery-queue.ts:204-210`):

- A retriable error after the 2-minute window: network, timeout, 5xx, 408, 429 (`send-with-retries.ts:36-48, 91-98`). Probe: 503 for 2 minutes rejects with status 503.
- A non-retriable response, no retry at all: any other 4xx (`send-with-retries.ts:37, 96-97`). Probe: a 400 pauses at once and `retry()` rejects with status 400.
- `POST /operations` answered 404 / 405: `'The server does not serve POST /operations. Update @lightmill/log-server.'` (`logger.ts:221-231`).
- A 413 on a single log (`logger.ts:235`, `delivery-queue.ts:198`; a multi-log 413 halves the batch and does not pause, l. 198-203).
- A result-count mismatch: `'The server answered a batch of N logs with M results'` (`logger.ts:238-244`).

Outside of a pause, one other throw exists: `'A paused queue holds items'` (`delivery-queue.ts:264`). Inferred unreachable: the only transitions out of `paused` are `retry()` and `discard()` (`#update`, l. 236-251), and `discard()` clears the queue and sets `idle`, so `paused` implies a non-empty queue.

Not a rejection reason (probe): `cancelRun({ discardInFlightLogs: true })` / `interruptRun(...)` called while `retry()` is pending. `discard()` empties the queue and emits a change (l. 310-320), so `flushUpTo`'s check sees nothing in flight up to `number` and resolves (l. 283-285), although the logs were dropped, not stored. Probe: `retry()` resolved, server stored `[]`, `addLog()` promises rejected with `AddLogError` ("discarded", `logger.ts:191-193`). So a resolved `retry()` can mean "logs are gone", if the caller also discards.

So `retry()` has no rejection path outside `state.error`, apart from that unreachable throw.

## Interaction with `flush`, `completeRun`, `cancelRun`, `interruptRun`

| Situation | Behavior | Evidence |
| --- | --- | --- |
| `flush()` / `completeRun()` while `paused` | Reject at once with the pause error. They do not retry and send nothing. `#ending` is reset in `finally`, so the logger stays `running`. | `flushUpTo` rejects on `paused` (l. 286-288). `logger.test.ts:601-602`. Probe: no new request. |
| `cancelRun()` / `interruptRun()` while `paused` (no discard) | Reject the same way. | `logger.test.ts:649`. |
| `cancelRun/interruptRun({ discardInFlightLogs: true })` while `paused` | Drop held logs, end the run. Later `retry()` is a no-op. | `logger.test.ts:640-660`. Probe. |
| `retry()` then `completeRun()` | Works: `retry()` stored the held logs, then `flush()` returns at once or checks the server. | `logger.test.ts:607-613`. Probe. |
| `completeRun()` called while `retry()` is pending | Both share the same delivery; both resolve when it succeeds. If it pauses again, both reject. | Inferred from `flushUpTo` sharing `#changes` (l. 279-291). Probe: both resolved, run `completed`. |
| `completeRun()` pending, then `retry()` | `retry()` is a no-op (queue not paused). | Probe (PATCH pending case). |
| `flush()` while `retrying`/`sending` | Waits through `retrying` (only `paused` rejects). | `delivery-queue.ts:286`. |

## Docs that already describe `retry()`

- `README.md:95`: "sends them again, with a fresh two minutes, and resolves once they are stored". Does not say that concurrent / non-paused calls resolve early.
- `README.md:171`: "Sends held logs again. Does nothing unless paused."
- `README.md:126`: `logger.retry().catch(() => {})`.
- `src/logger.ts:253-259` JSDoc: "resolves once the logs in flight when it was called are stored, or rejects if the logger pauses again before". Accurate for the call that leaves `paused`; incomplete for the no-op calls and for discard.
- `packages/react-experiment/README.md:201, 210`: same usage; "While it runs, the logger state goes back to `sending`".

## Probe scenarios (run, not committed)

All through `pnpm test --run <file>` in `packages/log-client`, using the real test server and msw, fake timers: idle; sending (held request); retrying (503 once); two concurrent calls while paused; logs added while paused and during retry; late log paused afterwards (400); retry rejects on 400; retry rejects after 2 minutes of 503; `flush`/`completeRun` while paused, then `retry()` + `completeRun()`; `completeRun()` during `retry()`; `cancelRun({discardInFlightLogs:true})` during `retry()`; `interruptRun({discardInFlightLogs:true})` from paused then `retry()`; `retry()` after `completeRun`/`cancelRun`/`interruptRun`; `retry()` while `completeRun()`'s PATCH is pending. 16 tests, all passed against `main` at `7deca67`.

## Open points (not answered here)

- Whether `Run`'s delivery hooks call `retry()` at all, and in which states: out of scope for this ticket.
- No existing test asserts the no-op results for `sending`, `retrying`, ended states, concurrent calls, or discard-during-retry; the facts above for them rest on the probe plus source reading.
