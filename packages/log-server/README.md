# Lightmill Log Server

A simple log server for user experiments. It is typically use in conjunction with [Lightmill Log Client](../log-client).

## Installation

```sh
npm install @lightmill/log-server
```

## Usage (CLI)

```sh
log-server start --database ./logs.sqlite
```

Other options are available via `log-server start --help`.

## Usage (API)

```js
import express from 'express';
import { LogServer, SQLiteStore } from '@lightmill/log-server';

let dbPath = process.env.DB_PATH;
let secret = process.env.SECRET;
let adminPassword = process.env.ADMIN_PASSWORD;
let port = process.env.PORT;

let server = express()
  .use(LogServer({ store: new SQLiteStore(dbPath), secret, adminPassword }))
  .listen(port);

server.start();
```

## Rest API

The Typescript types of the requests and responses are exported from the package as `Path`, `Method`, `PathParams`, `QueryParams`, `Body`, `Response`, `Error`, and `ErrorStatus`.
For example, the type of the expected request body of the `post /experiments/runs` endpoint is `Body<'post', '/experiments/runs'>`.

### `POST /sessions`

Start a new session.

#### Request examples

```json
{ "role": "participant" }
```

```json
{ "role": "admin", "password": "admin-password" }
```

#### Response example

```json
{
  "status": "ok",
  "role": "participant",
  "runs": []
}
```

### `GET /sessions/current`

Get the current session (if any), and the list of runs it has access to.

#### Response

```json
{
  "status": "ok",
  "role": "participant",
  "runs": [{ "runId": "run-id", "experimentId": "experiment-id" }]
}
```

### `DELETE /sessions/current`

End the current session.

### `POST /experiments/runs`

Start a new experiment run. If no session is active, a new session is started. If a session is active, the run is added to the session.

#### Request example

```json
{ "experiment": "experiment-id", "run": "run-id" }
```

If the `run` field is not provided, a random UUID is generated. If the `experiment` field is not provided, "default" is used.

#### Response example

```json
{
  "status": "ok",
  "experiment": "exp-id",
  "run": "run-id",
  "links": {
    "run": "/experiments/exp-id/runs/run-id",
    "logs": "/experiments/exp-id/runs/run-id/logs"
  }
}
```

### `PUT /experiments/:experiment/runs/:run`

This is used to mark as run as completed or canceled. "`:experiment`" and "`:run`" are the experiment and run IDs respectively, as provided in the response of the `POST /experiments/runs` endpoint. Client must have access to this run.

#### Request examples

```json
{ "status": "completed" }
```

```json
{ "status": "canceled" }
```

### `POST /experiments/:experiment/runs/:run/logs`

Add one or many log entries to a run. In the URL, "`:experiment`" and "`:run`" are the experiment and run IDs respectively, as provided in the response of the `POST /experiments/runs` endpoint. Client must have access to the run.

#### Request example

```json
{
  "logs": [
    {
      "type": "trial",
      "date": "2020-01-01T00:00:00.000Z",
      "values": {
        "trial": 1,
        "condition": "condition-1",
        "duration": 1234
      }
    },
    {
      "type": "trial",
      "date": "2020-01-01T00:00:10.000Z",
      "values": {
        "trial": 2,
        "condition": "condition-2",
        "duration": 2345
      }
    }
  ]
}
```

The date must be provided in ISO 8601 format.

### `GET /experiments/:experiment/runs/logs`

Get an experiment logs. In the URL, "`:experiment`" is the experiment ID. Client must have admin rights.

Providing an `Accept` header with the value `text/csv` will cause the server to respond with a CSV file instead of JSON.

In addition, query parameters can be used to filter the logs. For example, `?type=trial` will only return logs of type "trial" (at the moment, type is the only supported filter property).

#### JSON Response example

```json
[
  {
    "type": "trial",
    "experiment": "experiment-id",
    "run": "run-id",
    "date": "2020-01-01T00:00:00.000Z",
    "values": {
      "trial": 1,
      "condition": "condition-1",
      "duration": 1234
    }
  },
  {
    "type": "trial",
    "experiment": "experiment-id",
    "run": "run-id",
    "date": "2020-01-01T00:00:10.000Z",
    "values": {
      "trial": 2,
      "condition": "condition-2",
      "duration": 2345
    }
  }
]
```

#### CSV Response example

```csv
type,experiment,run,date,trial,condition,duration
trial,experiment-id,run-id,2020-01-01T00:00:00.000Z,1,condition-1,1234
trial,experiment-id,run-id,2020-01-01T00:00:10.000Z,2,condition-2,2345
```

## License

MIT
