---
description: Initialize Aftermath for this project with destructive-safe paths.
---

Initialize Aftermath in the current project so destructive commands are classified from day one.

Action: $ARGUMENTS (optional; pass flags such as `--dry-run`, `--no-wire`, `--run-tests`)

1. Run `npx @moah0911/aftermath init $ARGUMENTS` (or `node <aftermath-root>/scripts/init.js $ARGUMENTS` from a checkout).
2. Report the detected stacks, test/build commands, safe paths, and protected paths.
3. Tell the user to run the detected test command once to establish last-known-good, then use `/aftermath-status`.

Init writes only `.aftermath/config.json` (plus optional host wiring and a baseline with `--run-tests`). It never runs destructive commands. If init reports a missing test command, ask for the project's test command and add it under `testCommands` in `.aftermath/config.json`.
