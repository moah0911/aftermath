# Agent portability

Aftermath is agent-portable. The skills in `skills/` hold the core behavior; host-specific files are thin adapters that load that behavior.

| Host | Files | Notes |
|------|-------|-------|
| Any (fallback) | `AFTERMATH.md`, `AGENTS.md` | Always-on ladder, auto-loaded from repo root. No commands. |
| OpenCode | `.opencode/plugins/aftermath.mjs`, `.opencode/commands/`, `hooks/`, `skills/` | Server plugin injects the ladder each turn via `experimental.chat.system.transform`, persists `/aftermath` switches via `command.execute.before`, tripwires destructive/test/repeat/correction signals. |
| Claude Code | `.claude-plugin/plugin.json`, `commands/`, `hooks/claude-codex-hooks.json`, `hooks/session-start.cjs`, `hooks/pre-tool-use.cjs`, `skills/` | SessionStart injects the ladder; PreToolUse (Bash) blocks destructive commands. |
| Codex | `.codex-plugin/plugin.json`, `hooks/claude-codex-hooks.json`, `hooks/`, `skills/` | Same lifecycle hooks as Claude. |

Keep adapters thin. When a host supports skills or hooks, point it at the existing `skills/` and `hooks/` files. When a host only supports project instructions, keep its copied rule text aligned with `AFTERMATH.md` (verify with `node scripts/check-rule-copies.js`).
