# Exporting data

The log server exports logs as CSV, one row per log, either from the command line or over HTTP.

## From the command line

On the machine that has the database, run:

```sh
log-server export --database ./data.sqlite > logs.csv
```

`--database` defaults to `./data.sqlite`, or to the `DB_PATH` environment variable. To export part of the logs:

- `--experiment-name <name>` keeps the logs of one experiment.
- `--log-type <type>` keeps the logs of one type.

The command reads the database directly, so it works whether the server runs or not.

`--output logs.csv` (`-o logs.csv`) writes to a file instead, and shows progress when it runs in a terminal.

## Over HTTP

A host can download the same CSV from a running server. Open a host session, then request `GET /logs`. The first command asks for the host password; the server's `.env` file does not put that password in your terminal's environment.

```sh
curl --fail-with-body --cookie-jar host-cookies.txt --user host \
  --header 'Content-Type: application/vnd.api+json' \
  --data '{"data":{"type":"sessions","attributes":{"role":"host"}}}' \
  https://study.example.org/api/sessions

curl --fail-with-body --cookie host-cookies.txt --globoff \
  'https://study.example.org/api/logs?filter[experiment.name]=reaction-time' > logs.csv
```

`GET /logs` answers CSV unless the `Accept` header asks for JSON. Filters go in the query string, and each can be repeated to keep several values:

| Filter                    | Keeps the logs                 |
| ------------------------- | ------------------------------ |
| `filter[experiment.name]` | of the experiments named       |
| `filter[experiment.id]`   | of the experiments with the id |
| `filter[run.name]`        | of the runs named              |
| `filter[run.id]`          | of the runs with the id        |
| `filter[logType]`         | of the types given             |

`--globoff` stops curl from reading the square brackets as a pattern. `--fail-with-body` makes an HTTP error fail the command and keeps its error document available; if the download fails, its output is an error rather than a CSV. Keep the cookie file private. Once you are done, delete the session with `DELETE /sessions/current`, or let it expire.

## The CSV format

```csv
type,experiment_name,run_name,run_status,date,reaction_time,size,task_id
intro,reaction-time,participant-1,completed,2026-10-06T19:18:01.485Z,,,intro
trial,reaction-time,participant-1,completed,2026-10-06T19:18:03.411Z,101.59999999403954,large,large-0
```

- The first columns say where each log comes from: its `type`, `experiment_name`, `run_name`, and `run_status`. A filter that keeps a single type, experiment, or run name drops the matching column, since every row would have the same value.
- The other columns are the log values, one per value name found in the exported logs, in alphabetical order. A log without a value leaves its cell empty.
- Value names are converted to snake case: `reactionTime` becomes `reaction_time`. Avoid value names that become one of the first columns, such as `runName`: the value would replace that column.
- `date` is the time the client created the log, unless the log set its own `date`.
- Dates are ISO 8601 strings, booleans are `true` or `false`, and objects and arrays are JSON.
- Rows are sorted by experiment, run name, then log number.
- Runs that are not over yet are included: check `run_status` to keep only completed runs.
- Canceled runs are left out, and so are the logs a resume canceled.
- When no log matches, the output is empty, without even a header.

## As JSON

The CSV has no log number or ids. To get them, ask for JSON:

```sh
curl --cookie host-cookies.txt --globoff \
  --header 'Accept: application/vnd.api+json' \
  'https://study.example.org/api/logs?filter[logType]=trial'
```

The answer is a [JSON:API](https://jsonapi.org) document: each log has its `logType`, `number`, and `values`, and a relationship to its run. Add `include=run` to get the runs in the same answer. Unlike the CSV, the JSON includes the logs of canceled runs.

## Deleting data

The server can't delete data yet.
