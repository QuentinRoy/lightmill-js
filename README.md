# LightMill

LightMill is a TypeScript monorepo for building, running, and logging user
experiments.

It is organized as small focused packages that can be used independently or as
a full stack:

1. Design generation and iteration.
2. Timeline execution.
3. React rendering helpers.
4. Logging API contract, client, and server.

## Packages

| Package                         | Description                                                 | README                                                                         |
| ------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `@lightmill/convert-touchstone` | Convert TouchStone XML to Lightmill static design format.   | [packages/convert-touchstone/README.md](packages/convert-touchstone/README.md) |
| `@lightmill/static-design`      | Model static experiment designs and start run iterators.    | [packages/static-design/README.md](packages/static-design/README.md)           |
| `@lightmill/runner`             | Execute timeline iterators with lifecycle callbacks.        | [packages/runner/README.md](packages/runner/README.md)                         |
| `@lightmill/react-experiment`   | React `Run` component and hooks for task execution/logging. | [packages/react-experiment/README.md](packages/react-experiment/README.md)     |
| `@lightmill/log-api`            | Shared API contract and OpenAPI artifacts for logging.      | [packages/log-api/README.md](packages/log-api/README.md)                       |
| `@lightmill/log-client`         | Browser/client SDK for sessions, resumable runs, and logs.  | [packages/log-client/README.md](packages/log-client/README.md)                 |
| `@lightmill/log-server`         | Express middleware and SQLite datastore for logs.           | [packages/log-server/README.md](packages/log-server/README.md)                 |

## Quick Start

### Requirements

- Node.js 22.x
- pnpm 10+

### Install dependencies

```sh
pnpm install
```

### Build all packages

```sh
pnpm -r run build
```

### Run tests

```sh
pnpm -r run test
```

## Typical Stack

Common integration flow:

1. Convert or define a design with `@lightmill/convert-touchstone` or `@lightmill/static-design`.
2. Execute tasks with `@lightmill/runner` or `@lightmill/react-experiment`.
3. Persist logs through `@lightmill/log-client` + `@lightmill/log-server`.
4. Use `@lightmill/log-api` as source of truth for API schemas and types.

## Repository Layout

```txt
packages/
	convert-touchstone/
	static-design/
	runner/
	react-experiment/
	log-api/
	log-client/
	log-server/
```

## Development Notes

- Each package has its own `tsconfig`, test setup, and changelog.
- Public package entrypoints are defined through each package `exports` field.
- API-related packages (`log-api`, `log-client`, `log-server`) follow JSON:API media type conventions.
