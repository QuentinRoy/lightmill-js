# Agent Instructions

## Agent skills

### Issue tracker

GitHub issues and PRs are for humans; beads (`bd`) are for agents. See [`docs/agents/issue-tracker.md`](docs/agents/issue-tracker.md). Create a bead before writing code.

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

Before handing off, run `pnpm lint` and `pnpm test` (which also typechecks). A pull request that implements an issue says `Fixes #N` in its body. Leave merging to the maintainer. Close your beads when the pull request opens ([why and when to reopen](docs/agents/issue-tracker.md#closing-beads)).
