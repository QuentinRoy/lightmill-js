# Troubleshooting

Each section starts from a symptom and separates causes that need different fixes. They apply to the [getting started](getting-started.md) app on your computer and to a [deployed](deploying.md) study.

Three places show what went wrong:

- the browser's developer console, where the getting started app's error boundary records errors;
- the browser's Network panel, which shows each request to the log server, its response, and whether the session cookie was sent;
- the terminal running the log server, or your host's log viewer when it is deployed.

## The server does not start

Read the startup error, then:

- If the command itself fails, check that Node.js 24.12 or later is installed, that `@lightmill/log-server` is installed, and that the command runs in the directory that contains it.
- If the server reports a missing session key or host password, check the process's environment. A `.env` file must be in the directory where the command starts, and define `SESSION_KEY` and `HOST_PASSWORD`.
- If the database is missing, compare the path in the error with `DB_PATH` and any `--database` flag. A relative path such as `./data.sqlite` depends on the directory the command starts from, so starting it elsewhere looks for another file. For an existing study, find its database or restore a backup: `migrate` on the wrong path creates an empty database, and does not recover anything.
- If migrations are pending, stop the server, [back up the database](deploying.md#back-up-the-data), then migrate it.
- If the port is in use, check whether another log server is already running. Run one server per database.

To create a new database, or to migrate an existing one once it is backed up, run from the server's directory, with your own database path:

```sh
npx log-server migrate --database ./data.sqlite
```

Then start the server again.

## The app cannot find the experiment

The client looks up the experiment by the `experimentName` it passes to `startRun`, and fails when the server has none with that exact name. The client never creates experiments.

First check that the app's `apiRoot` reaches the intended server, that `experimentName` matches the study's name, and that the server uses the intended database. Fix a wrong address, name, or path before creating anything.

If the experiment was never created, run from the server's directory:

```sh
npx log-server experiment add reaction-time --database ./data.sqlite
```

If the command says the experiment already exists while the app still can't find it, the command and the app use different servers, databases, or names. Running it again won't fix that.

## The app cannot reach the server

In the Network panel, find a failed request to `sessions`, `experiments`, or `runs`, and check its URL:

- Locally, the page comes from Vite, usually at `http://localhost:5173`, and `apiRoot` must point to the log server, usually `http://localhost:3000`. Keep both running, and open the page on `localhost`.
- If a published app calls `http://localhost:3000`, it still has the development address: on a participant's computer, `localhost` is their own machine. Set `apiRoot` to the public address of the API, rebuild, and publish the new build. See [Build the app for HTTPS](deploying.md#build-the-app-for-https). If the old address remains, the browser may be loading the previous build; reload with the cache disabled.
- A connection error or a timeout means the browser can't reach that address: check the URL, the log server, and the proxy.
- A `404`, or an HTML page where JSON was expected, means the request reached the wrong path. With the deploying guide's proxy, the address must end with `/api`; a server reached directly may have no prefix.
- A [mixed-content error](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Mixed_content) means an HTTPS page calls an HTTP address. Serve the API over HTTPS and use that address.

Allowed origins can't fix a request sent to the wrong address.

## The browser blocks requests from another origin

A [Cross-Origin Resource Sharing (CORS)](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS) error in the console means the server doesn't allow the page's origin. Allow the address of the page, not of the API: its scheme, host, and port, without a path. For a page at `https://study.example.org/?participant=1`, that is `https://study.example.org`:

```sh
npx log-server start --same-site --allowed-origin https://study.example.org --trust-proxy
```

Locally, if Vite picks another port, such as `http://localhost:5174`, restart the server with that origin instead.

A page served from the same origin as the API needs no allowed origin. With `createLogServer`, configure the [`cors` middleware](../../packages/log-server/README.md#cross-origin-requests) instead of the flag.

## The browser cannot keep a participant session

The server identifies a participant with a cookie named `lightmill-session-id`. In the Network panel, follow the session requests when a run starts:

1. `GET /sessions/current` answers `404` before a session exists. That is expected: the client then creates one.
2. `POST /sessions` should answer `201` and set the cookie. If it answers an error, read it and the server's log.
3. Later requests must send the cookie back, and `GET /sessions/current` then answers `200`. The Network panel shows whether the cookie was sent or blocked. It is `HttpOnly`, so `document.cookie` doesn't show it.

If the browser blocks the cookie, read the reason it gives:

- With `--same-site`, the page and the API must be on the same site. Locally, use `localhost` for both: `localhost` and `127.0.0.1` are different sites.
- A cookie for an API on another site is a third-party cookie, which some browsers block. Move the app and the API to one site rather than asking participants to change their browser settings.
- Behind a proxy that handles HTTPS, the proxy must send `X-Forwarded-Proto: https`, and the server needs `--trust-proxy`. Otherwise, with `--secure-cookies always`, the server doesn't set the cookie at all; with `auto`, it sets one without `Secure`, which works but is misconfigured. See [Cookies](../../packages/log-server/README.md#cookies).

If the cookie is sent but the server doesn't recognize the session, it may have expired, the session key may have changed, or the server may use another database. A server built with `createLogServer` also needs a [persistent session store](../../packages/log-server/README.md#resuming-runs-after-a-restart). A new session doesn't own the runs of the lost one.

## A participant cannot start a run

Read the error code in the console, or in the response to `POST /runs`:

- `RUN_EXISTS`: a run that isn't canceled already has this name in the experiment. A completed run can't resume. A running or interrupted run resumes only through the session that created it, so only in the browser that started it, while its session lasts.
- `ONGOING_RUNS`: this browser's session already has a run that is idle, running, or interrupted, maybe under another participant number. A session can have only one ongoing run, across all experiments. Changing the participant number, opening another tab, or interrupting the run doesn't change that.

When testing, use a new participant number once the previous run is completed or canceled. To keep an unfinished test run, leave it and use another browser or browser profile. Don't clear cookies to recover: the session is what lets the old run resume.

To give a participant who dropped out a replacement, use a new participant number with the same condition order. See [assigning orders to participants](../../packages/counterbalancing/README.md#assigning-orders-to-participants).

To free a run name, a host can [cancel the run](deploying.md#cancel-a-run). Its logs then leave the CSV export.

## The saved task cannot be found

`No task matched resumeAfterTask` means the task named by the run's last log is missing from the rebuilt timeline. Compare the saved `taskId`, the ids the timeline has for this participant, and the comparison in `resumeAfterTask`.

If the design or the task ids changed after the run started, use the original design for that run. If `taskId` was logged wrong, or the comparison reads the wrong field, fix that first. Removing `resumeAfterTask` would replay the whole timeline while the logger continues the existing run. Keep the run and its data while you investigate. [Resuming runs](resuming-runs.md#what-the-app-needs) explains what resuming needs.

## Saving does not finish

Keep the page open: logs that haven't reached the server only exist in the page. After the last task, the getting started app shows "Saving…" while two steps happen:

1. `POST /operations` sends the remaining logs. The logger retries failures for up to two minutes, then pauses, and the app shows its retry and download screen. Once the connection or the server error is fixed, "Try again" sends the held logs again. If it still fails, download them before leaving.
2. `PATCH /runs/<id>` marks the run completed once every log is stored. It is retried too, but its failures don't pause the logger: if it fails for good, the error boundary shows its message. A refusal such as `MISSING_LOGS` means the server is missing some of the run's logs; retrying the held logs doesn't fix it.

The failed request's response and the server's log tell which step failed. Logs already stored stay stored, and [exports](exporting-data.md#the-csv-format) include runs that aren't completed. Keep the run while you investigate rather than canceling it.
