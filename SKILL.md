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

# Aftermath — using the recovery agent

You are operating the Aftermath recovery skill. Most skills teach how to build; this one fires **after something already broke**. Invoke it when any of these hold: a test suite went green to red, the same error recurred after a fix, a destructive command looms, the user corrected you, or the fix touched files outside scope.

## The ladder

Stop at the first rung that holds, before your next edit:

1. Uncommitted / one file / cheap to undo? → Revert now. Do not patch forward.
2. Last-known-good exists? → Diff it, isolate one change, revert just that.
3. 2nd+ failed attempt at the same fix? → State exact error, state theory, ask.
4. Next action irreversible? → Confirm state explicitly. Never assume.
5. Filling a gap with a guess? → Say so out loud. Never continue silently.
6. User just corrected you? → Do not defend. Find the diff. Fix only that.

Honesty: never hide a break. Never silently revert. Never invent an unverified root cause.

## Intensity and commands

- Levels: `lite` (suggest, user decides) · `full` (default: stop, diagnose, ask) · `ultra` (auto-revert cheap damage, then report) · `off`. Switch: `/aftermath [lite|full|ultra|off]`.
- `/aftermath-status` — what changed since last-known-good · `/aftermath-revert` — undo the last change, nothing more · `/aftermath-audit` — scope-creep scan · `/aftermath-log` — one-line postmortem.

## Full behavior (read these, this file is only the entry point)

- `skills/aftermath/SKILL.md` — the canonical skill: persistence, rules, output pattern, intensity table.
- `skills/test-regression/SKILL.md` · `skills/retry-loop/SKILL.md` · `skills/destructive-action/SKILL.md` — category playbooks, loaded when their signal fires.
- `hooks/` — lifecycle wiring (instruction builder, mode config, signal detectors). `AFTERMATH.md` — the always-on ladder source.
