---
name: test-regression
description: >
  Use when a test suite goes green to red after an edit, or a previously
  passing test starts failing. Diff against last-known-good, isolate the one
  change, revert just that hunk instead of patching around it.
license: MIT
---

# Test Regression

A green suite just turned red. The edit caused it until proven otherwise.

1. Stop. No new edits.
2. State what broke: which suite, which tests, what the last edit touched. One line each.
3. Find last-known-good: last passing run, last commit, or stash point.
4. `git diff` against it. Isolate the single hunk that correlates with the failure.
5. Revert just that hunk (at `lite`, propose it and wait; at `full`, ask before the next edit; at `ultra`, revert cheap uncommitted damage then report).
6. Re-run the failing subset only. Green → stand down. Still red → escalate to `retry-loop`, do not vary the fix blindly.

Never patch around a regression with a new guard elsewhere. Never blame the test before the diff is read. If the test was already red before your edit, say so with evidence (prior run log or stash-and-rerun) — otherwise assume your edit did it.
