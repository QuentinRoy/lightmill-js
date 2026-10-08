# Agent Instructions

## Agent skills

### Agent guidance

Use /writing-for-agents when editing agent directives. Preserve installed third-party skills; check `skills-lock.json` for installer provenance and put repository-specific adapters in `docs/agents/`.

### Issue tracker

GitHub issues track human-facing work; beads (`bd`) hold shared execution state. Read [`docs/agents/issue-tracker.md`](docs/agents/issue-tracker.md) when choosing a tracker, decomposing work, publishing specs or tickets, handing off unfinished work, or completing tracked work.

### Domain docs

Single-context: root [`GLOSSARY.md`](GLOSSARY.md) + [`docs/adr/`](docs/adr/). See [`docs/agents/domain.md`](docs/agents/domain.md).

### Prose

Use /prose when writing code comments, commit messages, pull requests, READMEs, documentation, or changesets. Keep prose clear, precise, and as concise as possible.

### Changesets

Use /changeset when deciding whether a change needs a changeset, or when adding, editing, or deleting one.

## Code

### Comments

Use comments to explain why code is written a certain way, not what it does. Only comment when the code itself isn't clear enough.

### Type assertions

Enforce invariants in code: narrow at runtime and throw (`instanceof` with a `TypeError`), or reshape the types so the invariant holds by construction (two nullables always set together become one nullable object). Keep an `as` only when it is the cleanest option, with a comment saying why.

### Data loss

Data loss is the worst failure. Every path that can drop data a caller handed over (an error, a limit, a timeout, ending a run) keeps that data recoverable by the caller or fails loudly to them. Data is discarded only when the caller explicitly asks.

## Finishing

1. Run `pnpm build-all`. Typecheck and log-client's tests read the built packages, log-server's `dist` included, so a stale build checks old code.
2. Hand off once `pnpm lint`, `pnpm typecheck`, and `pnpm test` all pass.

A pull request that implements an issue says `Fixes #N` in its body. Leave merging to the maintainer. For work tracked in beads, follow the [completion rules](docs/agents/issue-tracker.md#closing-beads).
