---
name: beads
description: Manage existing beads, coordinate decomposed work, or record durable handoffs under the repository tracker policy.
---

# Beads

Read [`docs/agents/issue-tracker.md`](../../../docs/agents/issue-tracker.md) before creating beads or routing discovered work. That policy decides which tracker applies; this skill covers bead operations.

## Work an existing bead

1. Read the bead, its comments, and its ancestors. Done when you can identify its deliverable and completion criterion and, for a decomposed effort, its coordinator.

```bash
bd show <id>
bd comments <id>
```

2. Claim before starting so concurrent workers see ownership.

```bash
bd update <id> --claim
```

3. Do the assigned work and record its result. For completion or unfinished handoff, follow the tracker policy's corresponding sequence. Done when the bead has verified completion evidence or recoverable remaining work, and the required parent review is complete.

## Create or connect beads

Use the tracker policy's publishing rules to create beads only for work it assigns to them. For dependencies, the argument order is the blocked bead followed by its blocker:

```bash
bd dep add <blocked-id> <blocker-id>
```

Done when every published bead has the fields required by the policy and every required blocking edge is recorded.

## CLI use

Use `bd <command> --help` for flags and `--json` for structured output. Use `bd update` for edits; `bd edit` launches an interactive editor. If hooks have not supplied tracker context, run `bd prime` to load the repository override and persistent memories.
