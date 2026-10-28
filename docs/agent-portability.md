# Agent portability

Aftermath is agent-portable. The skills in `skills/` hold the core behavior; host-specific files are thin adapters that load that behavior.

| Host | Files | Destructive block | Forward-edit freeze | Checkpoints |
|------|-------|-------------------|---------------------|-------------|
| Any (fallback) | `AFTERMATH.md`, `AGENTS.md` | — | — | — |
| OpenCode | `.opencode/plugins/aftermath.mjs`, `.opencode/commands/`, `hooks/`, `skills/` | full/ultra, path-aware (throws before execution) | full/ultra while a failure is unresolved | ultra + `autoRevert: true` |
| Claude Code | `.claude-plugin/plugin.json`, `commands/`, `hooks/claude-codex-hooks.json`, `hooks/session-start.cjs`, `hooks/pre-tool-use.cjs`, `skills/` | full/ultra, path-aware (exit 2) | — | — |
| Codex | `.codex-plugin/plugin.json`, `hooks/claude-codex-hooks.json`, `hooks/`, `skills/` | full/ultra, path-aware (exit 2) | — | — |

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
Codex inject the ladder at SessionStart and apply the same destructive policy in
PreToolUse; they do not freeze forward edits or checkpoint files.

Checkpoints are opt-in (`autoRevert`). They snapshot only files edited through
OpenCode's `edit`/`write` tools, restore only on a green→red test at `ultra`, and skip
files changed outside the agent. Auto-revert never touches committed or pushed history.

Keep adapters thin. When a host supports skills or hooks, point it at the existing
`skills/` and `hooks/` files. When a host only supports project instructions, keep its
copied rule text aligned with `AFTERMATH.md` (verify with `node scripts/check-rule-copies.js`).
