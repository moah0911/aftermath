# Agent portability

Aftermath is agent-portable. The skills in `skills/` hold the core behavior; host-specific files are thin adapters that load that behavior.

| Host | Files | Destructive block | Forward-edit freeze | Failure signals | Checkpoints |
|------|-------|-------------------|---------------------|-----------------|-------------|
| Any (fallback) | `AFTERMATH.md`, `AGENTS.md` | — | — | — | — |
| OpenCode | `.opencode/plugins/aftermath.mjs`, `.opencode/commands/`, `hooks/`, `skills/` | full/ultra, path-aware (throws before execution) | full/ultra | in-process | ultra + `autoRevert: true` |
| Claude Code | `.claude-plugin/plugin.json`, `commands/`, `hooks/claude-codex-hooks.json`, `hooks/session-start.cjs`, `hooks/pre-tool-use.cjs`, `hooks/post-tool-use.cjs`, `hooks/user-prompt-submit.cjs`, `skills/` | full/ultra, path-aware (exit 2) | full/ultra (Edit/Write/MultiEdit) | PostToolUse + UserPromptSubmit | — |
| Codex | `.codex-plugin/plugin.json`, `hooks/claude-codex-hooks.json`, `hooks/`, `skills/` | full/ultra, path-aware (exit 2) | full/ultra (Edit/Write/MultiEdit) | PostToolUse + UserPromptSubmit | — |

## Install commands

| Host | Command |
|------|---------|
| OpenCode | `curl -fsSL https://raw.githubusercontent.com/moah0911/aftermath/main/scripts/install.sh \| bash -s --` |
| Codex | `codex plugin marketplace add moah0911/aftermath --ref main && codex plugin add aftermath@aftermath` |
| Claude Code | `/plugin marketplace add moah0911/aftermath` then `/plugin install aftermath@aftermath` |
| Skills-only | `npx skills add moah0911/aftermath -g -y` |

Codex requires the marketplace to be registered before `plugin add`; the combined
line above does both. `scripts/install.sh --host codex` runs both automatically when
the `codex` CLI is on `PATH`.

## Project initialization

Run `aftermath init` (or `/aftermath-init`) in a project to write `.aftermath/config.json`.
It detects stacks and test/build commands, then records:

- `safePaths` — disposable artifacts (`node_modules`, `dist`, `coverage`, ...), only when
  present and gitignored.
- `protectedPaths` — source/test dirs, `.git`, secrets (`.env*`, `secrets*`, `*.pem`,
  `*.key`), and manifests/lockfiles.
- `testCommands` / `buildCommands` — used by the plugin to recognize custom commands.

The path-aware policy allows a filesystem delete only when every target is a literal
relative path inside the project, under a `safePath`, and not under a `protectedPath`.
Unknown, dynamic, absolute-outside, or protected targets stay blocked. Non-path
destructive commands (force push, reset --hard, clean, drop, prune, destroy) always
block unless explicitly allowlisted.

`aftermath init` never runs destructive commands. `--run-tests` is opt-in and records
`.aftermath/baseline.json`; `--dry-run` writes nothing; `--no-wire` skips host wiring.
See [`init.md`](init.md) for the full detection matrix, config schema, and policy rules.

## Host behavior

The OpenCode plugin injects the ladder each turn via `experimental.chat.system.transform`,
persists `/aftermath` switches via `command.execute.before`, and tripwires
destructive/test/repeat/flaky/build/dependency/merge/correction signals. Claude Code and
Codex inject the ladder at SessionStart, apply the destructive policy and forward-edit
freeze in PreToolUse, deliver failure/build/dependency/merge/flaky pointers from
PostToolUse, and persist mode/correction/state reminders in UserPromptSubmit. Both hook
hosts store session state in `$XDG_CONFIG_HOME/aftermath/state.json`; they do not
checkpoint files.

Hook commands resolve the install root from `CLAUDE_PLUGIN_ROOT` (Claude Code),
then `CODEX_PLUGIN_ROOT`, then `AFTERMATH_DIR` for manual checkouts.

Checkpoints are opt-in (`autoRevert`). They snapshot only files edited through
OpenCode's `edit`/`write` tools, restore only on a green→red test at `ultra`, and skip
files changed outside the agent. Auto-revert never touches committed or pushed history.

Keep adapters thin. When a host supports skills or hooks, point it at the existing
`skills/` and `hooks/` files. When a host only supports project instructions, keep its
copied rule text aligned with `AFTERMATH.md` (verify with `node scripts/check-rule-copies.js`).
