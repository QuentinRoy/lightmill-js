# Issue tracker: GitHub Issues and beads

GitHub issues and PRs are the human-facing record for QuentinRoy/lightmill-js. Beads hold shared execution state: ownership, dependencies, completion, and durable handoffs. A bare `#<n>` is a GitHub issue (`gh issue view <n> --comments`). Use `bd <command> --help` for bead operations.

## GitHub issue or bead

- Finish self-contained work directly; the PR records what changed and why. Routine steps such as editing, testing, and opening the PR need neither an issue nor a bead.
- Open or reuse a GitHub issue for deferred work, a human-facing spec, or an effort humans need to follow across several PRs or sessions. The PR that completes it says `Fixes #<n>`.
- Use beads when work has separately assignable parts whose ownership, dependencies, or completion must be shared, or when unfinished work needs a durable handoff to another agent. Task size, duration, and the existence of a GitHub issue alone do not warrant a bead.
- Each bead states a deliverable and a checkable completion criterion. For a durable handoff, also record the current state, remaining work, and relevant references. Reuse an existing bead when it already covers the work.
- When fixing one issue takes several PRs, make them a GitHub stack with `gh stack` (`gh stack --help`). Each says `Part of #<n>`, and the top one says `Fixes #<n>`.
- For a decomposed effort, create or reuse a root epic and record its coordinating agent and overall completion criterion. Put the separately assignable work in child beads. Link an existing GitHub issue with `--external-ref gh-<n>`; keep its problem and intended outcome there, with a pointer from the root.
- Record discovered work for later in a GitHub issue. Add a child bead when it belongs to an effort already decomposed in beads.
- PRs, commits, and changesets are for humans too: they name GitHub issues only, never bead ids.

## Closing beads

The coordinating agent recorded on the root owns epic closure. Subtask workers close their assigned beads and include parent readiness in their completion report.

1. Verify the bead's recorded completion criterion using the evidence requirements below, and record the supporting result.
2. Record newly discovered remaining scope and create any required children before reviewing parent completion. For a wayfinder map, this includes its `Not yet specified` section.
3. When completion is uncertain, ask the user, explaining what is uncertain. Keep the bead open pending their answer. When completion is verified, close the assigned bead with the evidence in its reason or a linked result.
4. Review the parent and its ancestors. The coordinator closes each epic only when every required child is closed, its recorded outcome is verified, and its result is recorded. Recheck child status immediately before closing; child counts alone establish only eligibility for review. Close verified epics by id.
5. Before the coordinator reports completion or hands off tracked work, the root and every affected ancestor must be either closed with verified evidence, open with identified unfinished work, or open with a completion question awaiting the user's answer.

Reopen an affected bead (`bd reopen <id>`) when its deliverable needs more work, and reopen every closed ancestor whose outcome becomes incomplete. Close them again under the same sequence.

| Deliverable                          | Completion evidence                                                                                                                       |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Implementation                       | Verified acceptance criteria and an open PR.                                                                                              |
| Child on a shared integration branch | Verified criteria and a commit available to the coordinator. Its implementation epic still requires completed integration and an open PR. |
| Research or decision                 | Recorded answer and links to resulting artifacts.                                                                                         |
| Other task                           | Evidence of its stated deliverable.                                                                                                       |

## Gotchas

- `bd` is `/opt/homebrew/bin/bd`, which non-login shells may not have on `PATH`.
- Every worktree shares the one database in the main checkout's `.beads/`.
- A ticket blocked by a dependency still shows `○ open` in `bd list`; `bd ready`, `bd blocked` and `bd graph <id>` show blocking.
- `.beads/PRIME.md` replaces the default `bd prime` workflow with a pointer to this policy. Persistent memories are still injected. Keep tracker policy here and CLI operations in /beads.
- `AGENTS.md` has no bd-generated section on purpose: hooks in `.claude/settings.json` and `.codex/hooks.json` load the custom prime text. So `bd setup codex --check` warns, and `bd setup codex` / `bd setup claude` re-add a section to `AGENTS.md` / create `CLAUDE.md`; after running them, remove what they added and keep only the hook changes.
- `bd comment <id> "..."` adds a comment; `bd comments <id>` lists them. Comments are append-only, so a decision's final answer goes in the close reason, and a correction is `bd reopen <id>` followed by `bd close <id> --reason "..."`.

## When a skill says "publish to the issue tracker"

For human-facing work or a spec, use `gh issue create --title "<title>" --body-file <file>`, or update the existing GitHub issue. Immediate implementation work stays in its PR.

For separately assignable parts of a decomposed effort, use `bd create "<title>" --parent <root-id> -t <task|bug|feature> --body-file <file>`.

For a durable handoff of unfinished work, update its existing bead or create one with `bd create "<title>" -t task --body-file <file>`.

## When a skill says "fetch the relevant ticket"

For a GitHub issue, use `gh issue view <n> --comments`. For a bead, use `bd show <id>`, then `bd comments <id>`.

## Installed skill adapters

This policy is the tracker configuration for the installed engineering skills. Use its routing and completion rules when their generic templates describe a tracker operation. Apply triage labels only when `docs/agents/triage-labels.md` defines them; this policy is sufficient setup when that optional file is absent.

- **/to-spec**: publish the human-facing spec under the publishing rules above.
- **/to-tickets**: publish the approved decomposition as child beads under its root epic, with native blocking edges, not as GitHub sub-issues. Publishing leaves the source GitHub issue intact and open; root bead metadata follows the decomposition rules. Delivered work follows the closure sequence above.
- **/implement-spec**: the spec is the GitHub issue and its tickets are the root epic's child beads. Implementers claim their bead; the draft PR says `Fixes #<n>` for the spec issue. Close beads and the epic under the closure sequence above.
- **/handoff**: record unfinished execution state in the bead specified by this policy. The skill's temporary handoff document points to that bead and other existing artifacts. A context-only handoff may use the temporary document alone.
- **/wayfinder**: use the operations below. Reconcile remaining scope before reviewing epic completion, even when the generic skill closes a ticket earlier in its sequence.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a root bead with one **child** bead per decision ticket. Beads are for agents, so the map has no GitHub issue; the human-facing record is the spec it leads to.

- **Map**: a root bead labelled `wayfinder:map`, whose description holds the `Destination`, `Notes`, `Decisions so far`, `Not yet specified`, and `Out of scope` sections. Edit it with `bd update <root-id> --body-file <file>`. Link a GitHub issue it serves with `--external-ref gh-<n>`. Its completion criterion is the map's Destination, including resolution of all in-scope fog.
- **Child ticket**: `bd create "<title>" --parent <root-id> -t task -l wayfinder:<type> --no-inherit-labels`, where `<type>` is `research`/`prototype`/`grilling`/`task`. The body is the `## Question`.
- **Blocking**: `bd dep add <blocked-id> <blocker-id>`. A ticket is unblocked when every blocker is closed.
- **Frontier**: the root's unassigned children (`bd children <root-id>`) that appear in `bd ready`; first by id wins.
- **Claim**: `bd update <id> --claim`, the session's first write.
- **Resolve**: update the map's named pointers and remaining scope, create any newly surfaced children, then close the ticket under the completion rules above with the answer as its close reason (`bd close <id> --reason "<answer>"`). Review the root only after the map reflects the result and remaining scope.
- **Asking**: define each internal term when a question first uses it, and describe what a user or participant sees before the mechanism behind it.
