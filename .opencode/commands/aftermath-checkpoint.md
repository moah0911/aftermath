---
description: Inspect, clear, or restore Aftermath checkpoints.
---

Manage the ultra checkpoint store.

Action: $ARGUMENTS (status, clear, restore; default status)

- status: report tracked files, last green time, and whether autoRevert is on.
- clear: discard all snapshots without touching files.
- restore: restore every tracked file whose content still matches the agent's edit; report conflicts. Never overwrite manual edits.

The plugin handles the action before this template runs. Restate the AFTERMATH REPORT line from context in one line, then stop.
