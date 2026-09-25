---
description: Show what changed since the last known-good state, in plain terms.
---

Run `git status --short`, `git diff --stat`, and `git log --oneline -5`. Then answer in plain terms, no jargon:

1. Which files changed and what each change was for (one line per file).
2. What the last-known-good state is (last passing test or last commit).
3. Which single hunk is the prime suspect if something broke, and why.

Do not edit anything. Status only. If the tree is clean, say so and name the HEAD commit.
