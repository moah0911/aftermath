---
description: Show what changed since the last known-good state, in plain terms.
---

Run `git status --short`, `git diff --stat`, and `git log --oneline -5`. Then answer in plain terms, no jargon:

1. Which files changed and what each change was for (one line per file).
2. What the last-known-good state is (last passing test, last commit, or the latest green checkpoint).
3. Which single hunk is the prime suspect if something broke, and why.
4. Whether an AFTERMATH STATE line says a failure is unresolved or a checkpoint is active. If so, repeat it verbatim first.

Do not edit anything. Status only. If the tree is clean, say so and name the HEAD commit.
