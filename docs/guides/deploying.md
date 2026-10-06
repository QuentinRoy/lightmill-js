# Deploying

An online experiment has two parts: the experiment app, which is static files, and the log server, a Node.js process with a SQLite database. This guide covers putting both online with the standalone `log-server` command. If you embed the server in your own Express app instead, the same choices apply through the [`createLogServer` options](../../packages/log-server/README.md#createlogserveroptions).

## What you need

This walkthrough uses one origin, `https://study.example.org`, with the app at `/` and the API at `/api`. Replace that domain with yours. It assumes you have:

- an experiment app, such as the [getting started](getting-started.md) app;
- a Linux server with Node.js 24.12 or later, npm, and [Caddy](https://caddyserver.com/docs/install) installed;
- a domain pointing to that server, with ports 80 and 443 available to Caddy;
- an unprivileged account named `lightmill` that owns `/srv/lightmill`, and a directory `/srv/my-experiment` where you can copy the app and Caddy can read it.

Have the server administrator create those accounts and directories if needed. Keep port 3000 reachable only by the proxy: the server will trust its forwarded headers. Run the log-server setup commands below as the account that owns `/srv/lightmill`. The service example uses systemd; another process manager can run the same command.

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

On the server, install the package in its own directory:

```sh
cd /srv/lightmill
npm init -y
npm install @lightmill/log-server
```

Create `/srv/lightmill/.env` with your own secrets:

```sh
SESSION_KEY=replace-with-a-long-random-string
HOST_PASSWORD=replace-with-another-secret
DB_PATH=/srv/lightmill/data.sqlite
```

Generate each secret with `openssl rand -base64 32`. Keep the file on the server and out of version control; `chmod 600 .env` limits access to its owner. The package reads `.env` from its working directory. `SESSION_KEY` signs participant cookies, and `HOST_PASSWORD` protects the researcher account. [Secrets](#secrets) explains rotation.

Still in `/srv/lightmill`, prepare the database and create the experiment:

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

Copy the resulting `dist` directory to `/srv/my-experiment/dist` on the server. For example, replace `deploy@your-server` with your server login:

```sh
scp -r dist deploy@your-server:/srv/my-experiment/
```

Changing the source URL after building does not change the files in `dist`; rebuild and copy them again after a change.

## Set up the reverse proxy

On the server, put this site block in Caddy's configuration file, usually `/etc/caddy/Caddyfile`. It serves the built app and forwards API requests to the log server. Caddy gets and renews the HTTPS certificate.

```caddyfile
study.example.org {
	handle_path /api/* {
		reverse_proxy localhost:3000 {
			header_up X-Forwarded-Prefix /api
		}
	}
	handle {
		root * /srv/my-experiment/dist
		try_files {path} /index.html
		file_server
	}
}
```

Caddy forwards the host, client address, and original protocol. `handle_path` removes `/api` before forwarding; `X-Forwarded-Prefix` tells the log server to put it back in resource links.

Validate the configuration, then reload Caddy:

```sh
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

If you use another proxy, have it set `X-Forwarded-For`, `X-Forwarded-Host`, and `X-Forwarded-Proto`. It must also set `X-Forwarded-Prefix` when it strips a path prefix.

## Run the server

Keep the process running under a process manager so it restarts after a crash or reboot. Run one server process per database: requests from each participant are ordered within one process only.

For systemd, create `/etc/systemd/system/lightmill.service`:

```ini
[Unit]
Description=LightMill log server
After=network.target

[Service]
User=lightmill
WorkingDirectory=/srv/lightmill
ExecStart=/usr/bin/node /srv/lightmill/node_modules/@lightmill/log-server/dist/cli.js start --same-site --trust-proxy
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

Replace `/usr/bin/node` with the path printed by `command -v node` on the server. Use a Node installation the `lightmill` account can execute. Change `User` if you used another account. The working directory matters: it is where the CLI reads `.env`.

Start the service and arrange for it to start on reboot:

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now lightmill
sudo systemctl status lightmill
```

This runs the equivalent of `npx log-server start --same-site --trust-proxy` in `/srv/lightmill`. The same-origin app needs no allowed-origin flag. To stop the service, run `sudo systemctl stop lightmill`; systemd sends `SIGTERM`, and the server finishes requests in progress before closing the database.

## Check the deployment

Open `https://study.example.org/?participant=9001` in a browser, using an unused participant number. Complete a few trials, then reload to check that saved progress resumes. Finish and wait for "Thank you!". Check it in every browser you plan to support.

On the server, export the test run's logs:

```sh
cd /srv/lightmill
npx log-server export --experiment-name reaction-time > test-logs.csv
```

Check that the run has status `completed` and the expected task ids. If the app cannot start a run, check the service log with `sudo journalctl -u lightmill`; [troubleshooting](#troubleshooting) covers common causes.

## Back up the data

The database is a single file. Back it up while the server runs with the `sqlite3` command line tool:

```sh
sqlite3 data.sqlite ".backup 'backup.sqlite'"
```

Copying the file with `cp` while the server writes to it can produce a broken copy.

Run that backup command in `/srv/lightmill`, or use absolute database and backup paths. Copy backups to separate storage and check that you can read them. A backup includes participant sessions as well as logs; keep it private, and preserve the session key separately so restored sessions stay valid.

## Upgrade

1. Stop the server with `sudo systemctl stop lightmill`, and wait for it to exit.
2. Back up the database.
3. In `/srv/lightmill`, install the version you want: `npm install @lightmill/log-server@<version>`.
4. Run `npx log-server migrate --database /srv/lightmill/data.sqlite`.
5. Start the server with `sudo systemctl start lightmill`, then check its status and logs.

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

Start with the error in the browser’s developer console or the service log. The sections below separate problems that need different fixes.

### The service does not start

On the server, read the startup error:

```sh
sudo journalctl -u lightmill -n 50 --no-pager
```

Use that error to choose the next step:

- If systemd cannot execute Node, check `ExecStart` in the service file. Its Node path must exist and be executable by the `lightmill` account.
- If the CLI reports a missing session key or host password, check that `WorkingDirectory` is `/srv/lightmill`, that this account can read `.env`, and that it defines `SESSION_KEY` and `HOST_PASSWORD`.
- If the database is missing, check the path printed in the error against `DB_PATH` and any `--database` flag. For an existing study, locate its database or restore a backup. Running `migrate` at a wrong path creates an empty database; it does not recover the study's data.
- If the error says migrations are pending, stop the service and [back up that database](#back-up-the-data), then migrate it as the account that owns it.
- If the port is already in use, check whether another log-server process is running. Keep one process per database; a migration does not fix a port conflict.

For a new database, or after backing up an existing one that needs migration, run in `/srv/lightmill`:

```sh
npx log-server migrate --database /srv/lightmill/data.sqlite
```

Use the actual database path if yours differs. Once the reported problem is fixed, restart the service with `sudo systemctl restart lightmill` and check its log again.

### The app cannot find the experiment

The client looks up an experiment by the `experimentName` passed to `startRun`. If that server has no experiment with the exact name, the client cannot start the run.

First check three values: the app's `apiRoot` must reach the intended log server, its `experimentName` must match the study's name, and the server must be using the intended database. Correct a wrong address, name, or database path before creating anything.

If this is a new study and the experiment has not been created yet, run from `/srv/lightmill` as the database owner:

```sh
npx log-server experiment add reaction-time --database /srv/lightmill/data.sqlite
```

Replace the name and database path with the ones your app and server use. This command creates an experiment, not participant runs. If it reports that the experiment already exists but the app still cannot find it, the command and app are likely using different servers, databases, or names; running it again will not fix that mismatch.

### The published app contacts localhost

In the browser's developer tools, open the Network panel and inspect a request to `sessions`, `experiments`, or `runs`. If its URL starts with `http://localhost:3000`, the published app still contains the development server address. On a participant's computer, that address cannot reach your public log server.

Follow [Build the app for HTTPS](#build-the-app-for-https): change the `apiRoot` value passed to `new Client` in `src/App.tsx` to your public API address, run `npm run build`, and replace the server's published `dist` files with that new build. Then reload and check that the request URL uses the public address. A page that still uses the old URL may be loading the previous build; check the files you copied and try reloading with the browser cache disabled in developer tools.

If the request already uses your public domain but returns an HTML page or a `404`, check the API path. With this guide's proxy, it must include `/api`; a server hosted directly at another address may not use that prefix. Match `apiRoot` to where the API is actually served. Changing `--allowed-origin` does not fix a request sent to the wrong address.

### Requests fail between different origins

Match `--allowed-origin` to the app's full origin, including its scheme and port. Use no path or trailing slash. Same-site addresses can still be different origins.

### The browser cannot keep a participant session

Check that the browser receives the `lightmill-session-id` cookie. Behind an HTTPS proxy, use `--trust-proxy` and forward `X-Forwarded-Proto: https`. Cross-site apps can also fail because the browser blocks third-party cookies.

### A participant number cannot start a run

A completed run cannot resume. An unfinished run needs its original browser session. For test runs, choose a new participant number. For a replacement, keep the old data and use a new identifier with the same condition order.

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
