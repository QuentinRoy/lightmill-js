---
name: changeset
description: Write changesets (`.changeset/*.md`) as one coherent changelog. Use when a change may need a changeset, and before adding, editing, or deleting one.
---

A changeset is a changelog entry for users of a package's **last release** (the top version in `packages/<package>/CHANGELOG.md`, prereleases included). `changeset version` concatenates every **pending changeset** into each bumped package's next release section, so the pending set is one document: each entry states the **net change** a user of the last release sees in the code as it ships.

Pending changesets are the `.changeset/*.md` files other than `README.md`. In prerelease mode (`.changeset/pre.json` exists), `.changeset/pre/` holds changesets earlier prereleases already consumed, which are not pending.

## 1. Read every pending changeset

Done when you can name the pending changeset that covers the behaviour your change touches, or know that none does.

## 2. Place the change

Measure the change against the last release, not against the branch. One change can take several branches:

- **Alters unreleased work** (fixes, renames, extends, or changes a default of something a pending changeset introduces): fold it into that changeset. Rewrite the entry as if the feature had shipped this way from the start.
- **Removes unreleased work**: trim that changeset, or delete it when nothing of it ships.
- **Invisible to users of the last release** (refactors, tests, docs, CI, tooling): no changeset.
- **A distinct change** to released behaviour, or a new capability: a new changeset per change. A PR may carry several.

## 3. Set the bump

Bump each affected package for the effect on a user of its last release: `major` when they must act to keep what they had (code, API, data, or visible behaviour), `minor` for a new capability, `patch` for a fix to released behaviour. After a fold, recheck the target's bump.

## 4. Write the entry

Write the file directly; `pnpm changeset` is interactive. Name it with a kebab-case slug of the change (`log-server-cli-start.md`). List every package the entry affects in the front matter.

```md
---
'@lightmill/log-server': minor
---

Summary.
```

Follow /prose, and match the packages' `CHANGELOG.md`:

- Lead with what the user can now do or must change, naming public API in backticks.
- For `major` only, add why, and how to migrate or keep the old behaviour.
- Describe only what users observe; internals belong in the PR.
- Write each paragraph on one line.

**Links.** `@changesets/changelog-github` links each entry to the PR and commit that added its file. When the file lands with the change, that link is right. When it lands elsewhere (a later PR, or a fold that makes another PR the better reference), point the entry at the most relevant PR and commit, usually those that introduced what the entry describes, with lines at the top of the summary, which the generator strips:

```md
pr: #233
commit: ab83b8bede215758236a79640d956dfa8b80470e

Summary.
```

Use the full commit hash.

## 5. Review the set

Reread every pending changeset as the next release's changelog. Done when each entry is one distinct change, no two overlap or contradict, every name and default matches the code, every link points at the most relevant PR and commit, and each entry reads true for a user of the last release.
