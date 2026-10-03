---
name: beads
description: Manage shared execution state in beads. Use when decomposing work with shared ownership or dependencies, recording a durable handoff of unfinished work, or finding, claiming, inspecting, resuming, or completing existing beads.
---

# Beads

Read [`docs/agents/issue-tracker.md`](../../../docs/agents/issue-tracker.md) before creating beads or routing discovered work. That policy decides which tracker applies; this skill covers bead operations.

## First Step

For work that the policy assigns to beads, load its context if the hooks have not already done so:

```bash
bd prime
```

If that prints nothing, check whether the repository has an active Beads workspace:

```bash
bd where
```

## Preferred Route

Use the `bd` CLI when shell access is available. It is the most compact and direct Beads interface.

## Core CLI Workflow

1. Find work:

```bash
bd ready
bd list --status=open
bd list --status=in_progress
```

2. Inspect before editing:

```bash
bd show <id>
```

3. Claim work atomically:

```bash
bd update <id> --claim
```

4. Record work the tracker policy assigns to beads:

```bash
bd create "Short title" --description="Deliverable and completion criterion" --type=task --priority=2
```

For part of a decomposed effort, add `--parent <root-id>`. For a durable handoff, use the description fields specified in the tracker policy; update an existing bead when one already covers the work.

5. Close verified work, then review its parent and ancestors under the tracker policy's completion rules:

```bash
bd close <id> --reason="<verified outcome and supporting PR or result>"
```

## Shared state

Each bead holds its deliverable, completion criterion, owner, dependencies, and result. Claim before starting so other workers can see ownership. Record blocking edges with:

```bash
bd dep add <blocked-id> <blocker-id>
```

## Rules

- Keep shared coordination state in the beads for that effort.
- Do not use `bd edit`; it opens an interactive editor. Use `bd update` flags instead.
- Prefer `--json` when parsing `bd` output programmatically.
- If hooks are installed, `bd prime` may already be injected. Run it manually when context is missing.
- Do not auto-close or mutate tasks unless the work is actually complete.
