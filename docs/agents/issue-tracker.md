# Issue tracker: GitHub Issues and beads

GitHub issues and PRs are for humans; beads are for agents. Humans follow and discuss work on GitHub Issues (QuentinRoy/lightmill-js): a bare `#<n>` is a GitHub issue (`gh issue view <n> --comments`). Agents track the ongoing work behind an issue in beads, driven by the `bd` CLI (`bd prime` is the command reference), so its sub-parts stay out of GitHub.

## GitHub issue or bead

- Each piece of work that ends in its own PR has a GitHub issue, and that PR says `Fixes #<n>`. Create the issue if it is missing.
- Stacked PRs are the exception: when fixing one issue takes several PRs, make them a GitHub stack with `gh stack` (`gh stack --help`). Each says `Part of #<n>`, and the top one says `Fixes #<n>`.
- Each GitHub issue has one root bead, linked with `--external-ref gh-<n>`. Its children (sub-tasks, wayfinder tickets, research, prototypes) are beads only.
- PRs, commits, and changesets are for humans too: they name GitHub issues only, never bead ids.

## Gotchas

- `bd` is `/opt/homebrew/bin/bd`, which non-login shells may not have on `PATH`.
- Every worktree shares the one database in the main checkout's `.beads/`.
- A ticket blocked by a dependency still shows `○ open` in `bd list`; `bd ready`, `bd blocked` and `bd graph <id>` show blocking.
- `AGENTS.md` has no bd-generated section on purpose: the `bd prime` hooks in `.claude/settings.json` and `.codex/hooks.json` load the beads workflow. So `bd setup codex --check` warns, and `bd setup codex` / `bd setup claude` re-add a section to `AGENTS.md` / create `CLAUDE.md`; after running them, remove what they added and keep only the hook changes.
- `bd comment <id> "..."` adds a comment; `bd comments <id>` lists them.

## When a skill says "publish to the issue tracker"

`bd create "<title>" -t <task|bug|feature|epic> --body-file <file>`.

## When a skill says "fetch the relevant ticket"

`bd show <id>`, then `bd comments <id>`.

## Wayfinding operations

Used by `/wayfinder`. The **map** is an epic with one **child** bead per ticket.

- **Map**: an epic labelled `wayfinder:map`, the root bead of a GitHub issue (create one at charting, its body the Destination; when the map reaches its destination, post the result there), holding the Destination / Notes / Decisions-so-far / Not-yet-specified / Out-of-scope body. Edit it with `bd update <map-id> --body-file <file>`.
- **Child ticket**: `bd create "<title>" --parent <map-id> -t task -l wayfinder:<type> --no-inherit-labels`, where `<type>` is `research`/`prototype`/`grilling`/`task`; `--no-inherit-labels` keeps `wayfinder:map` off the child. The body is the `## Question`.
- **Blocking**: `bd dep add <blocked-id> <blocker-id>`. A ticket is unblocked when every blocker is closed.
- **Frontier**: the map's unassigned children (`bd children <map-id>`) that appear in `bd ready`; first by id wins.
- **Claim**: `bd update <id> --claim`, the session's first write.
- **Resolve**: `bd comment <id> "<answer>"`, `bd close <id>`, then append a context pointer (gist + id) to the map's Decisions-so-far.
