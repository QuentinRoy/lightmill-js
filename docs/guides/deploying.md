# Deploying

An online experiment has two parts: the experiment app, which is static files, and the log server, a Node.js process with a SQLite database. This guide covers putting both online with the standalone `log-server` command. If you embed the server in your own Express app instead, the same choices apply through the [`createLogServer` options](../../packages/log-server/README.md#createlogserveroptions).

## Choose where the app and the server live

The server identifies each participant with a cookie, so where the app and the server live decides which cookies browsers accept. Two pages are on the same site when they share the scheme and the registrable domain: `https://study.example.org` and `https://api.example.org` are on the same site, `https://example.org` and `https://example.com` are not. The port does not count.

Serve the app and the server from the same origin, behind a reverse proxy that handles HTTPS. It is the simplest setup that works in every browser.

| Setup                                                                                     | `log-server start` flags                                                          |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Local development over HTTP                                                               | `--same-site --allowed-origin http://localhost:5173`                              |
| One origin behind an HTTPS proxy (recommended)                                            | `--same-site --trust-proxy`                                                       |
| Different origins on the same site, for example `study.example.org` and `api.example.org` | `--same-site --allowed-origin https://study.example.org --trust-proxy`            |
| Different sites (not recommended)                                                         | `--allowed-origin https://study.example.com`, plus `--trust-proxy` behind a proxy |

- `--allowed-origin` names a page origin allowed to call the server, without a path or a trailing slash. Repeat it for several origins. A page on the server's own origin needs none.
- `--same-site` gives the session cookie `SameSite=Strict`. Without it, the cookie is `SameSite=None`, which browsers only accept over HTTPS. When the page is on another site, that cookie is a third-party cookie: Safari blocks it by default, and other browsers let people block it. Participants with those browsers can't start a run.
- `--trust-proxy` makes the server believe the `X-Forwarded-*` headers of the proxy, so it knows requests came in over HTTPS and marks the cookie `Secure`. Only use it when every request goes through a proxy that sets these headers: a client reaching the server directly could forge them. If your proxy does not set `X-Forwarded-Proto`, use `--secure-cookies always` instead.

`--same-site` without `--trust-proxy` logs a warning, because the cookie is then `Secure` only when the server is reached directly over HTTPS. During local development, ignore it.

## Set up a reverse proxy

This [Caddy](https://caddyserver.com) configuration serves the built app and forwards `/api` to the server. Caddy gets and renews the HTTPS certificate on its own.

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

Build the app with `npm run build`, copy `dist` to `/srv/my-experiment`, and set the client's `apiRoot` to `https://study.example.org/api`. Start the server with `--same-site --trust-proxy`. `X-Forwarded-Prefix` lets the server build correct links to the resources it creates.

Any proxy works the same way: forward the requests, set `X-Forwarded-For`, `X-Forwarded-Host`, `X-Forwarded-Proto`, and `X-Forwarded-Prefix` when it strips a path prefix.

## Configure the server

Every option of `log-server start` has an environment variable. The server reads them from the environment and from a `.env` file in the directory it starts from.

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

## Run the server

Run the server under a process manager such as systemd, so it restarts after a crash or a reboot. To stop it, send `SIGTERM`: it finishes the requests in progress, then closes the database.

Run one server process per database. The server orders each participant's requests within one process only.

## Back up the data

The database is a single file. Back it up while the server runs with the `sqlite3` command line tool:

```sh
sqlite3 data.sqlite ".backup 'backup.sqlite'"
```

Copying the file with `cp` while the server writes to it can produce a broken copy.

## Upgrade

1. Back up the database.
2. Install the new version of `@lightmill/log-server`.
3. Run `log-server migrate --database <path>`.
4. Start the server again.

`log-server start` refuses to start while the database has pending migrations.
