# log-client error messages seen by participants

Question: which messages from `startRun` and `completeRun` (and what `Run`'s default error slot can show) read badly to a participant, what should each say, and is rewording breaking? Ticket: `lightmill-js-yqf.13`.

Criteria (owner): a message must be **C**lear, in the **P**articipant's plain words (no library, HTTP or internal terms, no ids), and suggest a **R**ecovery path (reload, check the connection, download the logs, contact the experimenter). The "Verdict" column lists the criteria a message fails. Line numbers are on `main` at 7deca67.

## How a message reaches `error.message`

- `RequestError` (`packages/log-client/src/utils.ts:3-65`) builds its message from the server's first error: `detail`, else `code`, else `status`, else `statusText` (`utils.ts:14-23`). So server `detail` strings in `packages/log-server/src` are user-facing strings. Gaps:
  - A failed response with no body, over HTTP/2 (empty `statusText`), gives `message === ''` (`utils.ts:18,22`; `unwrap` passes `''` at `utils.ts:94`).
  - `errors: []` makes the constructor throw a `TypeError` instead (`utils.ts:19-21` index `[0]` of an empty array).
- Platform errors pass through unchanged: `fetch` network failures (`TypeError`, text varies by browser: "Failed to fetch", "Load failed", "NetworkError when attempting to fetch resource.").
- `startRun` is not retried and has no timeout: it uses `#fetchClient` directly (`client.ts:70-78, 245, 260, 300, 329, 365`), never `sendWithRetries`. `completeRun` retries network errors, timeouts, 5xx, 408 and 429 for up to 2 minutes, then throws the last error (`send-with-retries.ts:5,37,48`; `logger.ts:343-360`).
- `completeRun` flushes first (`logger.ts:339`), so it can also reject with a delivery pause error (`delivery-queue.ts:288`, from `logger.ts:226-243`) or a `FlushError` (`logger.ts:275`).

## startRun

| Where | Current text | Verdict | Proposed |
|---|---|---|---|
| `client.ts:327` | `Couldn't find experiment ${experimentName}` | fails R, P (config error) | "This experiment is not available. Check the link you were given, or contact the experimenter." |
| `client.ts:283` (resume by name) | `Could not find run ${runName} for experiment ${experiment}` | fails C, P, R | "Your earlier progress could not be found from this browser. Reopen the experiment in the browser you started it in, or contact the experimenter." |
| `server app-runs-handlers.ts:62` `ONGOING_RUNS` (403) | `Client already has ongoing runs, end them first` | fails P, R ("client", "ongoing runs", asks for an action the participant cannot take) | "This browser already has an experiment in progress, so a new one cannot start. Go back to the tab where you started it, or contact the experimenter." |
| `server app-runs-handlers.ts:96` `RUN_EXISTS` (409) | `A run named ${name} already exists for experiment ${experimentId}` | fails C, P, R (internal experiment id, "run") | "This participant number was already used. If you already finished the experiment, thank you: there is nothing more to do. If you were interrupted, reopen it in the browser you started it in. Otherwise check your number or contact the experimenter." |
| `server app-runs-handlers.ts:106` `EXPERIMENT_NOT_FOUND` (403) | `Experiment "${experimentId}" not found.` | fails P, R | Same as `client.ts:327` row. |
| `server json-api.ts:183` `SESSION_REQUIRED` (403; resume does not call `#getOrCreateSession`, `client.ts:290-315`) | `A session is required. Post to /sessions to create one.` | fails C, P, R (HTTP path) | "Your browser lost track of your session, for example after cookies were cleared. Reload the page; if that does not help, contact the experimenter." |
| `server app-sessions-handlers.ts:48` `SESSION_EXISTS` (409; only on a race with another tab, `client.ts:362-373`) | `A session already exists. Delete it first.` | fails P, R | "The experiment is open in another tab of this browser. Close the other tab, then reload this page." |
| `server json-api.ts:153` / `app-runs-handlers.ts:150` `RUN_NOT_FOUND` (resume) | `Run "${id}" not found` | fails C, P, R | Same as `client.ts:283` row. |
| `server json-api.ts:177` `RUN_NOT_OWNED` (resume) | `Run "${id}" belongs to another session. Only the session that created a run can write to it.` | fails P, R | Same as `client.ts:283` row. |
| `server run-lifecycle.ts:113,119` `INVALID_STATUS_TRANSITION` (resume of a completed or canceled run) | `Cannot change run status: the run is canceled.` / `Cannot change run status from completed to running. Allowed transitions are: completed -> canceled.` | fails P, R (arrows, status names) | "This experiment can no longer be continued: it was already finished or stopped. Contact the experimenter if you think this is a mistake." |
| `server run-lifecycle.ts:85,92` mapped to `INVALID_LAST_LOG_NUMBER` | `Updating last log number is only allowed when resuming a run.` / `Cannot set last log number to N, run has only M logs. Ensure ...` | fails P, R | "Your progress could not be restored to the saved point. Contact the experimenter." |
| `server json-api.ts:190` `INTERNAL_SERVER_ERROR` (500) | the raw server `error.message` (any internal text, e.g. a database message) | fails C, P, R; also leaks internals | "The server had a problem. Reload the page and try again; if it keeps happening, contact the experimenter." |
| `server request-handling.ts:545-547` `SERVICE_UNAVAILABLE` (503, not retried by `startRun`) | `The server could not process the request right now, and nothing was saved. Try again.` | passes C, R; weak on P ("request") | "The server is busy. Wait a moment, then reload the page." |
| 404 / 405 without `detail` (`request-handling.ts:290` etc.) | the bare code, e.g. `NOT_FOUND` | fails C, P, R | Generic 4xx fallback: "The experiment server refused the request. Reload the page; if it keeps happening, contact the experimenter." |
| empty `statusText` (`utils.ts:18,22`) | `''` | fails C | Never empty: use the generic 4xx/5xx fallback texts. |
| `fetch` network failure (platform) | "Failed to fetch" / "Load failed" / "NetworkError ..." | fails C, P, R | "Cannot reach the server. Check your internet connection, then reload the page." |

Not reachable from `startRun` by the client: `INVALID_RUN_STATUS` on `POST /runs` (client always sends `running`, `client.ts:334`), `MISSING_CREDENTIALS` / `INVALID_CREDENTIALS` (participant role only, `client.ts:368`).

Adjacent, same screen as `useResumeRun`: `getResumableRuns` throws `Experiment ${id} was not included with the server's response` (`client.ts:136`) and `Log ${id} was not included ...` (`client.ts:143`). Fails C, P, R. Proposed: "The server sent an incomplete answer. Reload the page; if it keeps happening, contact the experimenter."

## completeRun

| Where | Current text | Verdict | Proposed |
|---|---|---|---|
| `logger.ts:328` | `Cannot end a run that is not running. Run is ${status}` | fails C, P, R. A programmer error (double call, e.g. a React strict-mode effect); `Run` should guard it | "This experiment has already ended. Reload the page; if it keeps happening, contact the experimenter." |
| `logger.ts:332` | `The run is already ending` | fails P, R. Same programmer error | "The experiment is already being finished. Wait a moment." |
| `logger.ts:275-277` `FlushError` | `Log number N is missing on the server after flushing. Add it if you still have it; otherwise resume the run after log number N-1 (this cancels later logs).` | fails P, R; addressed to the developer | "Some of your answers did not reach the server, so the experiment cannot be marked as finished. If a download is offered, save your data, then contact the experimenter." |
| `server run-lifecycle.ts:101` `MISSING_LOGS` (403) | `Cannot complete run: log number N is missing. Add all logs before completing the run.` | fails P, R | Same as the `FlushError` row. |
| `server run-lifecycle.ts:113,119` `INVALID_STATUS_TRANSITION` (run canceled by a host, or interrupted) | `Cannot change run status: the run is canceled.` / `... from interrupted to completed. Allowed transitions are: ...` | fails P, R | "This experiment was stopped before it could be finished. Contact the experimenter." |
| `server json-api.ts:153,177,183` `RUN_NOT_FOUND`, `RUN_NOT_OWNED`, `SESSION_REQUIRED` | see startRun rows | fails C, P, R | "Your browser lost track of your session, so your data may not be saved. Reload the page; if that does not help, contact the experimenter." |
| `server json-api.ts:190` 500 | raw internal message | fails C, P, R | Same as the startRun 500 row. |
| `server request-handling.ts:545-547` 503 (retried up to 2 min, then thrown) | `... nothing was saved. Try again.` | passes C, R; weak P | "The server is busy and could not save your data. Wait a moment, then reload the page." |
| `send-with-retries.ts:71` `TimeoutError` (last error after retries) | `The server did not answer within 10000 ms` | fails P, R (number, "server did not answer") | "The server is taking too long to answer. Check your internet connection, then reload the page." |
| `fetch` network failure after retries | "Failed to fetch" etc. | fails C, P, R | Same as the startRun network row. |
| `logger.ts:227-230` pause error (404/405 on `/operations`) | `The server does not serve POST /operations. Update @lightmill/log-server.` | fails P (HTTP, package name); developer text | "The experiment server is out of date and cannot save your data. Contact the experimenter." |
| `logger.ts:240-243` pause error | `The server answered a batch of N logs with M results` | fails C, P, R | "The server did not confirm all of your data. Reload the page; if it keeps happening, contact the experimenter." |
| `utils.ts:111` | `Unknown error` (a non-Error thrown inside a retried send) | fails C, R | "Something went wrong while contacting the server. Reload the page; if it keeps happening, contact the experimenter." |

Not reachable from `completeRun`: `The request was aborted` (`send-with-retries.ts:77`) needs a signal, and `#endRun` passes none (`logger.ts:343-360`).

## Other errors the default slot can show (binding and task failures)

Per `lightmill-js-yqf.7`, the slot gets every thrown failure unchanged, including `addLog` rejections that are not in flight. These are `Run`-binding errors; most signal a programmer bug.

| Where | Current text | Verdict | Proposed |
|---|---|---|---|
| `logger.ts:153-155` | `Can only add logs when logger is running. Logger is ${status}` | fails C, P, R | "The experiment has already ended, so your answer could not be saved. Reload the page." |
| `logger.ts:158` | `Cannot add logs while the run is ending` | fails P, R | "The experiment is being finished, so your last answer could not be saved. Reload the page." |
| `logger.ts:162-164` | `Trying to add a log without a type. Logs must have a type` | developer bug; fails P, R | "Something went wrong in the experiment. Reload the page; if it keeps happening, contact the experimenter." |
| `logger.ts:192` `AddLogError` | `The log was discarded when the run ended` | fails P, R | "Your last answer was not saved because the experiment ended. Contact the experimenter." |
| `logger.ts:195` `AddLogError` | wraps a delivery error's message (see tables above) | as above | as above |
| App task or serializer errors (`useLogWrapper`, `serializeLog`) | arbitrary | cannot be fixed in log-client | Default slot should not trust `error.message` for these. |

`error.message` is only as good as its source. A task bug throws arbitrary text that no log-client rewording reaches. The default slot should show one generic participant text plus recovery, and keep `error.message` for developers (console, or a collapsed detail), rather than rely on every source being worded for participants. This is a `Run` design choice for the default-slots ticket, not a log-client change.

## Where to reword

- **Best place for server errors:** `RequestError`'s constructor (`utils.ts:14-23`): map known `code`s to the texts above and fall back by status (4xx, 5xx, empty). `code`, `detail`, `errors` and `status` stay as the server sent them, so developers keep the raw text. Needs no server change.
- **Server `detail`:** documented as "for people" (`packages/log-api/README.md:20`) and pinned by server tests (`packages/log-server/__tests__/app-runs.test.ts:140,250`). Leave it developer-facing.
- **Client-thrown `Error`s** (`client.ts:283,327`, `logger.ts:328,332`, `logger.ts:227,241`): reword in place.
- **Platform errors** (network `TypeError`, `TimeoutError` text): cannot be reworded without wrapping, except `TimeoutError`, which log-client creates (`send-with-retries.ts:69-73`).

## Is rewording breaking?

Contract: classes and fields, not text. README documents `RequestError` `status`, `statusText`, `headers`, `errors`, `code`, `detail` (`packages/log-client/README.md:189`) and shows `instanceof` / `code` checks (`README.md:196-205`). It does not document `RequestError.message`. No changelog entry treats a message edit as breaking (`packages/log-client/CHANGELOG.md` has none).

| Change | Breaking? |
|---|---|
| Reword plain `Error` messages (`client.ts:283,327`, `logger.ts:328,332,227,241`) | No by contract (the README documents "a plain `Error`", `README.md:193`, not its text). Code matching `.message` breaks. Tests pin `The server does not serve POST /operations...` (`logger.test.ts:435`), `The run is already ending` (`logger.test.ts:633-634`), and the add-log text (`logger.test.ts:630-631`). |
| Reword `RequestError.message` via a `code` table | No by contract: class, `code`, `detail`, `status` unchanged. Tests pin fallback-to-code messages such as `[RequestError: RUN_NOT_FOUND]` (`logger.test.ts:197-199, 272, 280`). Developers lose the raw text from `.message` (still on `.detail`). |
| Reword `TimeoutError` message | No: the `name` stays. |
| Reword `FlushError` | Soft yes: the README says its message "names the number and how to recover" (`README.md:191`). Keep the number on a new field (for example `firstMissingLogNumber`) and update the README. Tests pin the text (`logger.test.ts:225-227`). |
| Wrap platform errors (network `TypeError`) in a new class | Yes for `instanceof TypeError` checks (keep the original as `cause`). Avoid; let `Run` handle non-`RequestError` errors instead. |
| Reword server `detail` | Yes for API consumers and server tests; unnecessary given the `RequestError` table. |

Suggested release shape: a minor changeset for log-client (new texts, `FlushError` field), and a note in the README errors section that `.message` is for participants and `.detail` / `.code` are for programs.
