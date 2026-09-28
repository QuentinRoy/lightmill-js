# Issue tracker: beads

Issues and specs live in beads, driven by the `bd` CLI; `bd prime` is the command reference. GitHub Issues (QuentinRoy/lightmill-js) receive external bug reports: a bare `#<n>` is a GitHub issue (`gh issue view <n> --comments`), and a bead links one with `--external-ref gh-<n>`.

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

- **Map**: an epic labelled `wayfinder:map`, holding the Destination / Notes / Decisions-so-far / Not-yet-specified / Out-of-scope body. Edit it with `bd update <map-id> --body-file <file>`.
- **Child ticket**: `bd create "<title>" --parent <map-id> -t task -l wayfinder:<type> --no-inherit-labels`, where `<type>` is `research`/`prototype`/`grilling`/`task`; `--no-inherit-labels` keeps `wayfinder:map` off the child. The body is the `## Question`.
- **Blocking**: `bd dep add <blocked-id> <blocker-id>`. A ticket is unblocked when every blocker is closed.
- **Frontier**: the map's unassigned children (`bd children <map-id>`) that appear in `bd ready`; first by id wins.
- **Claim**: `bd update <id> --claim`, the session's first write.
- **Resolve**: `bd comment <id> "<answer>"`, `bd close <id>`, then append a context pointer (gist + id) to the map's Decisions-so-far.
