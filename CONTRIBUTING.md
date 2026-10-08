# Contributing

## Set up

You need Node.js 24.12 or later and pnpm 12 or later.

```sh
pnpm install
pnpm build-all
```

Build before you test or typecheck: the tests and the typecheck read the built packages, including the generated OpenAPI types, so a stale build checks old code.

```sh
pnpm test
pnpm typecheck
pnpm lint
```

A change is ready once all three pass after a fresh `pnpm build-all`.

## Repository layout

```txt
packages/
  convert-touchstone/   Touchstone XML to timelines
  counterbalancing/     condition orders
  runner/               timeline runner, no UI
  react-experiment/     TimelinePlayer and hooks
  log-api/              HTTP API contract and OpenAPI document
  log-client/           browser client for the log server
  log-server/           Express middleware, SQLite datastore, CLI
docs/
  guides/               user guides
  adr/                  architecture decisions
GLOSSARY.md             glossary of domain terms
```

Each package has its own `README.md`, `CHANGELOG.md`, tests, and TypeScript configuration. Public entry points are the `exports` of each `package.json`.

Use the terms of [`GLOSSARY.md`](GLOSSARY.md) in code and docs, and record decisions that are hard to reverse in [`docs/adr/`](docs/adr/).

## Changesets

Every change that users of a package can see needs a changeset in `.changeset/`. Docs, tests, and refactors don't. The changelogs are generated from them at release.

## Working on the log server

Run the CLI from source:

```sh
pnpm --filter @lightmill/log-server cli start --same-site --allowed-origin http://localhost:5173
```

Set `SESSION_KEY` and `HOST_PASSWORD` in the environment or in `packages/log-server/.env`. `cli-watch` restarts the server on every change. The log API packages (`log-api`, `log-client`, `log-server`) follow [JSON:API](https://jsonapi.org). `log-client` generates its types from the OpenAPI document that `log-api` builds, so rebuild `log-api` after changing a route.

## Browser support

`log-client` supports Chrome and Edge 85, Firefox 90, and Safari 15 (macOS and iOS) or later. It ships as ES2022 without transpiling, and uses no browser API newer than these versions. Keep it that way, or raise these versions in a major release. They are the `browserslist` of its `package.json`, which `pnpm lint` checks with eslint-plugin-compat. The plugin misses some APIs, such as `AbortSignal.any()`, so check new ones against MDN too.
