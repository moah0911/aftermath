---
name: destructive-action
description: >
  Use when the next action is irreversible: force push, drop, delete, rm,
  overwrite, schema migration, or permission change. Confirm current state
  explicitly and never proceed on assumption. Also covers scope creep: fix
  touched files outside the stated task.
license: MIT
---

# Destructive Action

Irreversible means unrecoverable. Slow down to the speed of verification.

## Before any destructive command

1. Stop. Name the command and what it destroys, in plain terms.
2. Confirm current state explicitly: `git status --short`, `git diff --stat`, remote/branch/database target. No proceeding on assumption.
3. Check cheapness: uncommitted / one file / cheap to undo? If not cheap, require explicit user confirmation with the target named back.
4. At `full`, ask before running. At `ultra`, still ask — ultra auto-reverts cheap damage only, never auto-destroys.
5. After running, report what changed and how to verify it.

## Scope-creep check (same skill, same caution)

1. `git diff --name-only` against task start. List every file outside the stated scope.
2. Revert or justify each one out loud. "While I was here" is not a justification.
3. Fix only the breaking diff. Move everything else to the audit (`/aftermath-audit`), not into this fix.

Never force-push, drop, or `rm -rf` on a guessed path. A destructive command with an unverified target is rung 5 (guessing) plus rung 4 (irreversible) — stop on both.
