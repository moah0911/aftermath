---
description: Undo the last change, nothing more.
---

Undo the last change and nothing more:

1. Run `git diff` (and `git status --short`) to identify the single most recent hunk.
2. Revert just that hunk or file to its last-known-good state. Prefer `git checkout -- <file>` for a single cheap file, or a targeted reverse-apply for a single hunk. Never touch anything else.
3. Announce what was undone and why in two lines: `undid: [X] / reason: [Y]`. Silence is forbidden.
4. Do not make any forward edit after the revert. Re-run the failing subset, then stop and wait for confirmation.

The plugin clears the forward-edit freeze and any checkpoints when this command runs. If there is nothing uncommitted to revert, say so and do nothing. Never revert committed or pushed history without explicit confirmation naming the commit.
