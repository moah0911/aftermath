---
description: Write a one-line postmortem entry (what broke, what fixed it).
---

Write a one-line postmortem so patterns become visible over time.

Entry text: $ARGUMENTS (if empty, derive it from the last resolved failure: what broke + what fixed it).

1. Emit the line in session in this exact format: `YYYY-MM-DD | broke: [X] | fixed: [Y]`.
2. Append the same line to `AFTERMATH.log` in the repo root (create it if missing). If the repo root is not writable, append to `~/.config/aftermath/log` instead and say which file was used.
3. Keep it to one line. No essay, no root-cause invention — unverified theory is labeled theory.

Postmortem: $ARGUMENTS
