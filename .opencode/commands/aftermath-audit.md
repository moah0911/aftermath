---
description: Scan the current diff for scope creep beyond what was asked.
---

Audit the working tree for scope creep:

1. Run `git diff --name-only` and `git diff --stat`.
2. Against the stated task ($ARGUMENTS — or the last user request if empty), classify each changed file: in-scope or out-of-scope.
3. Report a delete-list: every out-of-scope file with a one-line reason it does not belong in this fix.
4. Do not revert anything yet. Propose which hunks to keep and which to drop, then wait.

Stated task: $ARGUMENTS

Rule: "while I was here" is not a justification. Fix only the breaking diff.
