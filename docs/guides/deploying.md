# Deploying

An online experiment has two parts: the experiment app, which is static files, and the log server, a Node.js process with a SQLite database. This guide covers putting both online with the standalone `log-server` command. If you embed the server in your own Express app instead, the same choices apply through the [`createLogServer` options](../../packages/log-server/README.md#createlogserveroptions).

## What you need

You need an experiment app, a place to publish its static files over HTTPS, and an environment that can run Node.js 24.12 or later with a writable, persistent location for the database. Use your host's instructions to publish the app and keep the Node.js process running.

The example below uses `https://study.example.org` for the app and `/api` for the log server. Replace that address with yours. It includes an optional [Caddy](https://caddyserver.com/docs/install) proxy configuration; another proxy or a host that handles HTTPS can serve the same layout.

## Choose where the app and the server live

The server identifies each participant with a cookie. Browsers check both the page's address and the server's address before allowing a request and its cookie. Two terms describe those addresses:

- An origin is the scheme (`http` or `https`), hostname, and port together. Changing any of them changes the origin.
- A site groups addresses with the same scheme and registrable domain: the domain someone can register, such as `example.org`. Its subdomains belong to the same site, and the port does not count. `localhost` and `127.0.0.1` are different sites.

| Addresses compared                                          | Same origin? | Same site? |
| ----------------------------------------------------------- | ------------ | ---------- |
| `http://localhost:5173` and `http://localhost:3000`         | No           | Yes        |
| `https://study.example.org` and `https://api.example.org`   | No           | Yes        |
| `https://study.example.org` and `https://study.example.com` | No           | No         |

The allowed-origin setting decides whether browser code on another origin can read the server's response. The cookie settings decide whether the browser accepts and sends the participant's session cookie. A setup can need an allowed origin even when both addresses are on the same site.

Serve the app and the server from one origin behind a reverse proxy that handles HTTPS. A reverse proxy accepts the browser's request, then forwards it to the log server. This setup avoids relying on third-party cookies.

## Prepare the log server

In the environment where the log server will run, choose a writable directory for its package and configuration:

```sh
mkdir my-log-server
cd my-log-server
npm init -y
npm install @lightmill/log-server
```

Set `SESSION_KEY` and `HOST_PASSWORD` through your host's environment settings, or create a `.env` file in `my-log-server`:

```sh
SESSION_KEY=replace-with-a-long-random-string
HOST_PASSWORD=replace-with-another-secret
DB_PATH=./data.sqlite
```

Use different long random values for the two secrets, for example generated with `openssl rand -base64 32`. Keep `.env` private and out of version control. The package reads it from its working directory. `SESSION_KEY` signs participant cookies, and `HOST_PASSWORD` protects the researcher account. [Secrets](#secrets) explains rotation.

`DB_PATH` is the database file. This example keeps it in `my-log-server`; run the CLI commands from that directory. If your host replaces this directory during deployment, set `DB_PATH` to an absolute path in its persistent storage instead. The database contains both answers and sessions and must survive restarts and app updates. Keep it outside the directory that serves the app's public files.

Still in `my-log-server`, prepare the database and create the experiment:

```sh
npx log-server migrate
npx log-server experiment add reaction-time
```

Use the same experiment name as your app. If you are moving an existing study, copy its database with the server stopped and preserve its session key, rather than creating an empty database.

## Build the app for HTTPS

`apiRoot` is the base address of the log server's API. The browser adds route paths such as `/sessions` and `/runs` to it. The tutorial sets it to `http://localhost:3000` because the log server is running on your development machine.

When someone opens the published app, `localhost` refers to their own computer. Their browser needs the public address where you serve the log API instead. This guide's proxy serves it at `https://study.example.org/api`, so its session requests go to `https://study.example.org/api/sessions`.

On your development machine, find `new Client<Log>` in the tutorial's `src/App.tsx` and replace its `apiRoot` value before building:

```ts
const client = new Client<Log>({ apiRoot: 'https://study.example.org/api' });
```

Use your domain. Include `/api` only if your server or proxy serves the API at that path; a server exposed at `https://api.example.org` uses that address without `/api`.

In the app directory, build the static files:

```sh
npm run build
```

Publish the generated `dist` files using your host's deployment instructions. If you use the Caddy example below, set its `root` to the absolute path of that published directory.

Changing the source URL after building does not change the files in `dist`; rebuild and copy them again after a change.

## Set up the reverse proxy

If you use Caddy, this site block serves the built app and forwards API requests to the log server. Replace the domain and `/path/to/my-experiment/dist` with your public domain and the absolute path of the published app. Caddy gets and renews the HTTPS certificate.

```caddyfile
study.example.org {
	handle_path /api/* {
		reverse_proxy localhost:3000 {
			header_up X-Forwarded-Prefix /api
		}
	}
	handle {
		root * /path/to/my-experiment/dist
		try_files {path} /index.html
		file_server
	}
}
```

Caddy forwards the host, client address, and original protocol. `handle_path` removes `/api` before forwarding; `X-Forwarded-Prefix` tells the log server to put it back in resource links.

Apply the configuration through your Caddy installation's [configuration instructions](https://caddyserver.com/docs/caddyfile). Match `localhost:3000` to the address where the log-server process listens. Keep that backend reachable only by the proxy when using `--trust-proxy`, so outside clients cannot forge its forwarded headers.

If you use another proxy, have it set `X-Forwarded-For`, `X-Forwarded-Host`, and `X-Forwarded-Proto`. It must also set `X-Forwarded-Prefix` when it strips a path prefix.

## Run the server

From `my-log-server`, start the API for the same-origin HTTPS proxy example:

```sh
npx log-server start --same-site --trust-proxy
```

The command reads the secrets and database path from the environment and `.env` in its working directory. It listens on port 3000 unless `PORT` or `--port` changes it. The same-origin app needs no allowed-origin flag. [Other setups](#other-setups) shows the flags for different app and server addresses.

Use your host's process manager or application settings to keep this command running and make its diagnostic output available. Run one server process per database: requests from each participant are ordered within one process only. When stopping the log-server process, send `SIGTERM`; it finishes requests in progress before closing the database.

## Check the deployment

Open `https://study.example.org/?participant=9001` in a browser, using an unused participant number. Complete a few trials, then reload to check that saved progress resumes. Finish and wait for "Thank you!". Check it in every browser you plan to support.

From `my-log-server`, export the test run's logs:

```sh
npx log-server export --experiment-name reaction-time > test-logs.csv
```

Check that the run has status `completed` and the expected task ids. If the app cannot start a run, read the terminal running the server or your host's log viewer. [Troubleshooting](#troubleshooting) covers common causes.

## Back up the data

The database is a single file. Back it up while the server runs with the `sqlite3` command line tool:

```sh
sqlite3 data.sqlite ".backup 'backup.sqlite'"
```

Copying the file with `cp` while the server writes to it can produce a broken copy.

Run that backup command from the directory containing `data.sqlite`, or use the database path configured in `DB_PATH`. Copy backups to separate storage and check that you can read them. A backup includes participant sessions as well as logs; keep it private, and preserve the session key separately so restored sessions stay valid.

## Upgrade

1. Stop the log-server process through your host or process manager, and wait for it to exit.
2. Back up the database.
3. In `my-log-server`, install the version you want: `npm install @lightmill/log-server@<version>`.
4. Run `npx log-server migrate` from that directory, using the same `DB_PATH` as the server. Pass `--database <path>` if needed to select that file explicitly.
5. Start the server again with the same configuration, then check its diagnostic output and test the app.

Keep the database and `.env` in place. `log-server start` refuses to start while the database has pending migrations. If an upgrade fails, preserve the current database before restoring a backup; logs received after that backup are not in it.

## Other setups

The examples below change the start flags for other app and server addresses:

| Setup                                                                                     | `log-server start` flags                                                          |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Local development over HTTP                                                               | `--same-site --allowed-origin http://localhost:5173`                              |
| One origin behind an HTTPS proxy (recommended)                                            | `--same-site --trust-proxy`                                                       |
| Different origins on the same site, for example `study.example.org` and `api.example.org` | `--same-site --allowed-origin https://study.example.org --trust-proxy`            |
| Different sites (not recommended)                                                         | `--allowed-origin https://study.example.com`, plus `--trust-proxy` behind a proxy |

- `--allowed-origin` names a page origin allowed to call the server, without a path or a trailing slash. Repeat it for several origins. A page on the server's own origin needs none.
- `--same-site` gives the session cookie `SameSite=Strict`. Without it, the cookie is `SameSite=None`, which browsers only accept over HTTPS. When the page is on another site, that cookie is a third-party cookie: Safari blocks it by default, and other browsers let people block it. Participants with those browsers can't start a run.
- `--trust-proxy` makes the server believe the `X-Forwarded-*` headers of the proxy, so it knows requests came in over HTTPS and marks the cookie `Secure`. Only use it when every request goes through a proxy that sets these headers: a client reaching the server directly could forge them. Your proxy must send `X-Forwarded-Proto: https` for HTTPS requests. `--secure-cookies always` still requires the server to recognize HTTPS; it cannot replace that header. Without it, this mode prevents the server from setting a session cookie.

`--same-site` without `--trust-proxy` logs a warning, because the cookie is then `Secure` only when the server is reached directly over HTTPS. During local development, ignore it.

## Server options

Some options of `log-server start` have environment-variable equivalents, listed below. The server reads them from the environment and from a `.env` file in the directory it starts from. `--same-site`, `--trust-proxy`, and `--secure-cookies` have no environment-variable equivalents; pass them on the command line.

| Option                   | Environment variable   | Default         |
| ------------------------ | ---------------------- | --------------- |
| `--database`, `-d`       | `DB_PATH`              | `./data.sqlite` |
| `--port`, `-p`           | `PORT`                 | `3000`          |
| `--session-key`, `-s`    | `SESSION_KEY`          | required        |
| `--host-password`, `-w`  | `HOST_PASSWORD`        | required        |
| `--allowed-origin`       | `ALLOWED_ORIGINS`      | none            |
| `--session-max-age-days` | `SESSION_MAX_AGE_DAYS` | `30`            |
|                          | `LOG_LEVEL`            | `info`          |

`ALLOWED_ORIGINS` is a comma-separated list. `LOG_LEVEL` is one of `trace`, `debug`, `info`, `warn`, or `error`.

### Secrets

`SESSION_KEY` signs the session cookies. Use a long random string, for example from `openssl rand -base64 32`, and keep it stable: changing it signs every participant out, and they can't resume their runs. To replace it without signing anyone out, put the new key first and keep the old one after a colon (`SESSION_KEY=new-key:old-key`). The server signs with the first key and accepts all of them. Remove the old one once its cookies have expired.

`HOST_PASSWORD` protects the host account (user `host`). A host reads every experiment, run, and log, creates experiments, and cancels any run. Only send it over HTTPS.

### Sessions

A participant's session lasts as long as its cookie: 30 days by default, or `--session-max-age-days`. The session is what lets a participant find and resume their run, so set it to cover your whole study. Sessions are stored in the database, so they survive restarts. A participant who clears their cookies, or switches browser or device, can't resume. See [Resuming runs](resuming-runs.md).

## Troubleshooting

Start with the error in the browser's developer console, the terminal running the server, or your host's log viewer. The sections below separate problems that need different fixes.

### The server does not start

Read the startup error in the terminal where you ran `npx log-server start`, or in your host's log viewer. These diagnostic messages describe the server process; participant answers are stored in SQLite and retrieved with [exports](exporting-data.md).

Use that error to choose the next step:

- If the host cannot run the command, check that it has the required Node version, the package is installed, and the configured working directory contains that package.
- If the CLI reports a missing session key or host password, check the process's environment settings. If you use `.env`, it must be readable in the directory where the command starts and define `SESSION_KEY` and `HOST_PASSWORD`.
- If the database is missing, check the path printed in the error against `DB_PATH` and any `--database` flag. For an existing study, locate its database or restore a backup. Running `migrate` at a wrong path creates an empty database; it does not recover the study's data.
- If the error says migrations are pending, stop the server and [back up that database](#back-up-the-data), then migrate it as the account that owns it.
- If the port is already in use, check whether another log-server process is running. Keep one process per database; a migration does not fix a port conflict.

For a new database, or after backing up an existing one that needs migration, run from the server package directory:

```sh
npx log-server migrate --database ./data.sqlite
```

Use the actual database path if yours differs. Once the reported problem is fixed, start the server again through your host or with the same CLI command, and check its diagnostic output.

### The app cannot find the experiment

The client looks up an experiment by the `experimentName` passed to `startRun`. If that server has no experiment with the exact name, the client cannot start the run.

First check three values: the app's `apiRoot` must reach the intended log server, its `experimentName` must match the study's name, and the server must be using the intended database. Correct a wrong address, name, or database path before creating anything.

If this is a new study and the experiment has not been created yet, run from the server package directory, with access to its database:

```sh
npx log-server experiment add reaction-time --database ./data.sqlite
```

Replace the name and database path with the ones your app and server use. This command creates an experiment, not participant runs. If it reports that the experiment already exists but the app still cannot find it, the command and app are likely using different servers, databases, or names; running it again will not fix that mismatch.

### The published app contacts localhost

In the browser's developer tools, open the Network panel and inspect a request to `sessions`, `experiments`, or `runs`. If its URL starts with `http://localhost:3000`, the published app still contains the development server address. On a participant's computer, that address cannot reach your public log server.

Follow [Build the app for HTTPS](#build-the-app-for-https): change the `apiRoot` value passed to `new Client` in `src/App.tsx` to your public API address, run `npm run build`, and replace the server's published `dist` files with that new build. Then reload and check that the request URL uses the public address. A page that still uses the old URL may be loading the previous build; check the files you copied and try reloading with the browser cache disabled in developer tools.

If the request already uses your public domain but returns an HTML page or a `404`, check the API path. With this guide's proxy, it must include `/api`; a server hosted directly at another address may not use that prefix. Match `apiRoot` to where the API is actually served. Changing `--allowed-origin` does not fix a request sent to the wrong address.

### Requests fail between different origins

Open the browser's developer tools and inspect the failed request in the Network panel. Different failures need different fixes:

- A connection error or timeout means the browser cannot reach that address. Check the request URL, the log-server process, and the proxy. An allowed-origin flag cannot start a stopped server or correct a wrong address.
- A `404`, or an HTML response where JSON was expected, can mean the request reached the wrong path. Check the [API address](#the-published-app-contacts-localhost) and proxy routing.
- If the console reports a [mixed-content error](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Mixed_content), an HTTPS page is trying to use an HTTP resource the browser blocks. Serve the API over HTTPS and use its HTTPS address.
- If the console reports an origin or [Cross-Origin Resource Sharing (CORS) error](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS), check the app's origin against the server's allowed origins.

The origin to allow is the address of the page in the browser, including its scheme and port, without a path. For an app at `https://study.example.org/?participant=1`, that is `https://study.example.org`. Pass `--allowed-origin https://study.example.org` when starting the CLI, then restart the log-server process with the updated flags. Do not put the API address or `/api` in this option.

This guide's app and API share one origin, so they need no allowed-origin flag. Separate origins on the same site still need it. If you embed `createLogServer` in your own app, the CLI flag does not apply; configure the [`cors` middleware](../../packages/log-server/README.md#cross-origin-requests) instead. Once the browser can read responses, check session cookies separately below.

### The browser cannot keep a participant session

The server identifies a participant by a cookie named `lightmill-session-id`. In the browser's Network panel, inspect the session requests when starting a run:

1. `GET /sessions/current` can return `404` before a session exists. That is expected: the client then creates one with `POST /sessions`.
2. `POST /sessions` should return `201` and set the cookie. If it returns an error instead, read that response and the server log first.
3. Later requests must send the cookie back. A subsequent `GET /sessions/current` should return `200`. The Network panel can show whether the cookie was sent or blocked. It is `HttpOnly`, so `document.cookie` cannot show it.

If the browser blocks the cookie, use the reason shown in its developer tools. Check that the page and API share a site when using `--same-site`; `localhost` and `127.0.0.1` do not. A cookie for an API on another site can be blocked as a third-party cookie. Move the app and API to one site rather than asking participants to weaken their browser settings.

Behind a proxy that handles HTTPS, the proxy must send `X-Forwarded-Proto: https`, and the log server must use `--trust-proxy`. With `--secure-cookies always`, failing to recognize HTTPS prevents the server from setting the cookie. With `auto`, it can instead set a cookie without `Secure`, which leaves the deployment incorrectly configured even if login works. See [Cookies](../../packages/log-server/README.md#cookies).

If the request sends the cookie but the server no longer recognizes the session, check whether it expired, whether the session key changed, or whether the server is now using a different database. The CLI keeps sessions in its database; an embedded server also needs a [persistent session store](../../packages/log-server/README.md#resuming-runs-after-a-restart). Creating another participant session does not give it ownership of runs from the lost session.

### A participant number cannot start a run

Read the error code in the browser console or the response to `POST /runs`. These two codes mean different things:

- `RUN_EXISTS`: a run that is not canceled already uses this name in the experiment. A completed run cannot resume. A running or interrupted run can resume only through the session that created it; returning to the original browser helps only if that session still exists. See the [session checks above](#the-browser-cannot-keep-a-participant-session).
- `ONGOING_RUNS`: this browser session already owns an idle, running, or interrupted run. The server allows only one ongoing run per session, even across experiments. Changing the participant number, opening a new tab, or interrupting the old run does not remove that restriction.

For a new test, use an unused participant number after the browser's previous run has completed or been deliberately canceled. If an unfinished test must stay intact, keep its page open and use another browser or a separate browser profile with a fresh session and an unused number. Do not clear cookies as a recovery step: the original session is what lets you resume the old run.

For a replacement participant, use a new identifier and assign the old participant's condition order. The replacement's session must also have no ongoing run. Keep the original data unless you deliberately choose to cancel that run.

If a participant has lost their session, keep the original run unless you deliberately want to cancel it. Canceling frees its name but excludes its logs from CSV exports. To cancel it, first [open a host session](exporting-data.md#over-http), then request the run list as that host:

```sh
curl --fail-with-body --cookie host-cookies.txt --globoff \
  'https://study.example.org/api/runs?filter[experiment.name]=reaction-time&filter[name]=participant-9001'
```

Read the run's `id` from the JSON response. Replace `123` in both places below with that id, after checking that you selected the intended run:

```sh
curl --fail-with-body --request PATCH --cookie host-cookies.txt \
  --header 'Content-Type: application/vnd.api+json' \
  --data '{"data":{"type":"runs","id":"123","attributes":{"status":"canceled"}}}' \
  https://study.example.org/api/runs/123
```

The database keeps the canceled run and its logs. [JSON exports](exporting-data.md#as-json) can still retrieve them.
