---
name: aftermath
description: >
  Post-failure recovery when something already broke: test suite went green to
  red, same error repeats after a fix, destructive command looms, user says
  "you broke it", or the fix touched files outside scope. Stop, revert cheap
  damage, diagnose honestly, return to last-known-good. Use when any failure
  signal fires, when asked to revert, audit scope, or write a postmortem.
  Supports intensity levels lite, full (default), ultra. Use ONLY for
  recovery after failure, not for planning new work.
license: MIT
---

# Aftermath

Recovery after failure. Most skills teach how to build. This one teaches how to stop when you broke something.

## Persistence

ACTIVE EVERY RESPONSE while a failure is unresolved. No drift back to forward-editing. Still active if unsure. Off only via `/aftermath off`. Default: **full**. Switch: `/aftermath lite|full|ultra|off`.

## The ladder

Stop at the first rung that holds. Re-read it mid-panic before your next edit:

1. Uncommitted / one file / cheap to undo? → Revert now. Do not patch forward.
2. Last-known-good exists (passing test, last commit)? → Diff against it, isolate the one change, revert just that.
3. 2nd+ failed attempt at the same fix? → Stop varying the fix. State the exact error, state your theory, ask.
4. Next action irreversible (force push, drop, delete, overwrite)? → Confirm current state explicitly. Do not proceed on assumption.
5. Filling a gap with a guess right now? → Say so out loud instead of continuing silently.
6. User just corrected you ("you broke it")? → Do not defend the last step. Find the diff. Fix only that.

## Rules

- Never hide that something broke. Say what broke in one line before doing anything else.
- Never silently revert at full intensity and above. Announce every revert: what was undone and why.
- Never fabricate a root cause that has not been verified. Unverified theory is labeled theory.
- One bad edit, then stop. Compounding-edit count is the metric: 1 bad edit + revert beats 4 bad edits + patch-around.
- Revert the actual bad hunk, not a patch around it. `git diff` first, smallest revert that restores last-known-good.
- Scope discipline: fix only the diff that broke. Anything outside the stated task goes in the audit, not in the fix.

## Output

State first, then act: what broke (one line), what was undone (one line), what is next (one line). If the explanation is longer than the fix, the fix is not isolated yet.

Pattern: `broke: [X] → undid: [Y] → next: [Z].`

## Intensity

| Level | What changes |
|-------|--------------|
| **lite** | Flags the problem, suggests the revert, lets the user decide. No auto-stop. |
| **full** | Stops forward motion automatically, runs the diagnostic (diff, isolate), asks before the next edit. Default. |
| **ultra** | Auto-reverts to last known-good state without asking (uncommitted / cheap damage only), then reports what was undone and why. |

Example: test suite went green to red after an edit.
- lite: "Tests broke after this edit (3 failures in auth.spec). Suggest reverting auth.ts hunk 2 — proceed?"
- full: "Stopping. Broke: auth.ts hunk 2 broke 3 tests. Undid nothing yet. Diff isolated — revert just that hunk before any new edit?"
- ultra: "Broke: auth.ts hunk 2 broke 3 tests. Undid: reverted that hunk to last commit. 3 tests green again. No other files touched."

## When NOT to recover

Anything explicitly committed, pushed, or marked irreversible by the user is not auto-reverted — not even on ultra. Confirm first. A revert you do not understand is a second bug.

## Boundaries

Aftermath governs recovery, not construction. Once the session is back to last-known-good (tests green, diff clean, user confirms), stand down and return to the building skill. Level persists until changed or session end.
