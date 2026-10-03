# Agent Instructions

## Agent skills

### Issue tracker

GitHub issues track human-facing work; immediate work can go directly to a PR. Use beads (`bd`) for shared execution state and durable handoffs. See [`docs/agents/issue-tracker.md`](docs/agents/issue-tracker.md) when decomposing work, handing off unfinished work, or choosing where to record it.

### Domain docs

Single-context: root [`CONTEXT.md`](CONTEXT.md) + [`docs/adr/`](docs/adr/). See [`docs/agents/domain.md`](docs/agents/domain.md).

### Prose

Use /prose when writing code comments, commit messages, pull requests, READMEs, documentation, or changesets. Keep prose clear, precise, and as concise as possible.

### Changesets

Use /changeset when writing a changeset.

## Code

### Comments

Use comments to explain why code is written a certain way, not what it does. Only comment when the code itself isn't clear enough.

### Type assertions

Enforce invariants in code: narrow at runtime and throw (`instanceof` with a `TypeError`), or reshape the types so the invariant holds by construction (two nullables always set together become one nullable object). Keep an `as` only when it is the cleanest option, with a comment saying why.

### Data loss

Data loss is the worst failure. Every path that can drop data a caller handed over (an error, a limit, a timeout, ending a run) keeps that data recoverable by the caller or fails loudly to them. Data is discarded only when the caller explicitly asks.

## Finishing

Before handing off, run `pnpm lint`, `pnpm typecheck`, and `pnpm test`. `pnpm typecheck` needs the packages built first (`pnpm build-all`). A pull request that implements an issue says `Fixes #N` in its body. Leave merging to the maintainer. For work tracked in beads, follow the [completion rules](docs/agents/issue-tracker.md#closing-beads).
