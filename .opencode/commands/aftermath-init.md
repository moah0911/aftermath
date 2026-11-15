---
description: Initialize Aftermath for this project with destructive-safe paths.
---

Initialize Aftermath in the current project so destructive commands are classified from day one.

Action: $ARGUMENTS (optional; pass flags such as `--dry-run`, `--no-wire`, `--run-tests`)

1. Run the initializer — one command, then report its output. Do not read the
   package source first; the command prints everything you need.

   ```bash
   # if the package is installed locally (fastest, no registry lookup):
   node node_modules/@after.math/aftermath/scripts/cli.js init $ARGUMENTS --json
   # otherwise:
   npx @after.math/aftermath init $ARGUMENTS --json
   ```

   Add `--host opencode|claude|codex|all` only when the user asks for a
   specific host. By default the initializer wires only the agent you are
   running in — it never touches another agent's configuration.

2. Report the detected stacks, test/build commands, safe paths, and protected
   paths (they are in the `--json` output under `config`).
3. If no test command was detected, ask the user for the project's test
   command and add it under `testCommands` in `.aftermath/config.json`.
4. Tell the user to run the detected test command once to establish
   last-known-good (`init --run-tests` does this for you), then use
   `/aftermath-status`.

Init writes only `.aftermath/config.json` (plus optional host wiring and a baseline with `--run-tests`). It never runs destructive commands.
