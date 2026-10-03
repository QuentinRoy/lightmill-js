# Issue tracker: GitHub Issues and beads

GitHub issues and PRs are the human-facing record for QuentinRoy/lightmill-js. Beads hold shared execution state: ownership, dependencies, completion, and durable handoffs. A bare `#<n>` is a GitHub issue (`gh issue view <n> --comments`). Use `bd <command> --help` for bead operations.

## GitHub issue or bead

- Finish self-contained work directly; the PR records what changed and why. Routine steps such as editing, testing, and opening the PR need neither an issue nor a bead.
- Open or reuse a GitHub issue for deferred work, a human-facing spec, or an effort humans need to follow across several PRs or sessions. The PR that completes it says `Fixes #<n>`.
- Use beads when work has separately assignable parts whose ownership, dependencies, or completion must be shared, or when unfinished work needs a durable handoff to another agent. Task size, duration, and the existence of a GitHub issue alone do not warrant a bead.
- For a durable handoff, record the deliverable, current state, remaining work, and relevant references in a bead. Link an existing GitHub issue with `--external-ref gh-<n>` when applicable.
- When fixing one issue takes several PRs, make them a GitHub stack with `gh stack` (`gh stack --help`). Each says `Part of #<n>`, and the top one says `Fixes #<n>`.
- When decomposing a GitHub issue, create one root bead linked with `--external-ref gh-<n>`. Keep the overall problem and intended outcome in the GitHub issue; the root points to it, and child beads hold the separately assignable work.
- Record discovered work for later in a GitHub issue. Add a child bead when it belongs to an effort already decomposed in beads.
- PRs, commits, and changesets are for humans too: they name GitHub issues only, never bead ids.

## Closing beads

- Close an implementation bead when its completion criteria are verified and its PR opens. The maintainer merges outside agent sessions, so the bead tracks completion of the implementation work; `Fixes #<n>` tracks delivery on GitHub.
- Close a research or decision bead when its answer is recorded and any resulting artifacts are linked.
- The coordinating agent owns epic closure. Agents working individual subtasks close their assigned beads.
- After closing a child, review its parent for completion. The coordinator verifies the parent's stated outcome against recorded evidence, including relevant PRs, verification results, and research answers. Close it when every required child is complete and its own deliverable is recorded; recheck child status immediately before closing. Apply the same review to its ancestors.
- When completion is uncertain, ask the user, explaining what is uncertain. Keep the bead open pending their answer.
- Before handing off tracked work, verify that each open ancestor identifies unfinished work or a completion question awaiting the user's answer.

Reopen an affected bead (`bd reopen <id>`) when its deliverable needs more work, then close it under the same completion rule. Reopen its parent if that makes the parent incomplete.

## Gotchas

- `bd` is `/opt/homebrew/bin/bd`, which non-login shells may not have on `PATH`.
- Every worktree shares the one database in the main checkout's `.beads/`.
- A ticket blocked by a dependency still shows `○ open` in `bd list`; `bd ready`, `bd blocked` and `bd graph <id>` show blocking.
- `.beads/PRIME.md` replaces the default `bd prime` workflow with a pointer to this policy. Persistent memories are still injected. Keep tracker policy here and CLI operations in /beads.
- `AGENTS.md` has no bd-generated section on purpose: hooks in `.claude/settings.json` and `.codex/hooks.json` load the custom prime text. So `bd setup codex --check` warns, and `bd setup codex` / `bd setup claude` re-add a section to `AGENTS.md` / create `CLAUDE.md`; after running them, remove what they added and keep only the hook changes.
- `bd comment <id> "..."` adds a comment; `bd comments <id>` lists them.

## When a skill says "publish to the issue tracker"

For human-facing work or a spec, use `gh issue create --title "<title>" --body-file <file>`, or update the existing GitHub issue. Immediate work stays in its PR.

For separately assignable parts of a decomposed effort, use `bd create "<title>" --parent <root-id> -t <task|bug|feature> --body-file <file>`.

For a durable handoff of unfinished work, update its existing bead or create one with `bd create "<title>" -t task --body-file <file>`.

## When a skill says "fetch the relevant ticket"

For a GitHub issue, use `gh issue view <n> --comments`. For a bead, use `bd show <id>`, then `bd comments <id>`.

## Wayfinding operations

Used by `/wayfinder`. The human-facing **map** is a GitHub issue; a linked root bead coordinates one **child** bead per decision ticket.

- **Map**: a GitHub issue labelled `wayfinder:map`, holding the Destination / Notes / Decisions-so-far / Not-yet-specified / Out-of-scope body. Edit it with `gh issue edit <n> --body-file <file>`. Create a root bead with `bd create "<title>" -t epic --external-ref gh-<n> --description="Decision tickets for <issue-url>"`; the root points to the map.
- **Child ticket**: `bd create "<title>" --parent <root-id> -t task -l wayfinder:<type> --no-inherit-labels`, where `<type>` is `research`/`prototype`/`grilling`/`task`. The body is the `## Question`.
- **Blocking**: `bd dep add <blocked-id> <blocker-id>`. A ticket is unblocked when every blocker is closed.
- **Frontier**: the root's unassigned children (`bd children <root-id>`) that appear in `bd ready`; first by id wins.
- **Claim**: `bd update <id> --claim`, the session's first write.
- **Resolve**: `bd comment <id> "<answer>"`, `bd close <id>`, then append a named pointer to the answer in the GitHub map's Decisions-so-far. When the map reaches its destination, record the result there and close the root bead.
