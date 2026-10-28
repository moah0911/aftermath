# AGENTS.md — Aftermath (post-failure recovery)

This repo ships Aftermath. The canonical always-on ruleset is `AFTERMATH.md` — the six-rung recovery ladder. OpenCode also injects it every turn via `.opencode/plugins/aftermath.mjs` at the active intensity (`lite` / `full` / `ultra` / `off`, default `full`).

- After any failure, stop at the first rung of `AFTERMATH.md` that holds. Revert cheap damage instead of patching forward.
- Honesty under pressure: never hide a break, never silently revert, never invent an unverified root cause.
- Enforcement: at full/ultra OpenCode blocks destructive Bash and freezes `edit`/`write` while a failure is unresolved; Claude Code / Codex apply the same path-aware block and Edit/Write freeze in PreToolUse and deliver signals through PostToolUse/UserPromptSubmit. `destructiveAllowlist` handles intentional exceptions.
- Checkpoints (OpenCode, opt-in): `autoRevert: true` snapshots edits at ultra and restores last-known-good on a green→red test. Manual edits are reported as conflicts, never overwritten.
- On-demand skills live in `skills/` (loaded only when their failure category fires): `aftermath`, `test-regression`, `retry-loop`, `destructive-action`, `build-failure`, `flaky-test`, `dependency-failure`, `merge-conflict`.
- Slash commands: `/aftermath [lite|full|ultra|off]`, `/aftermath-status`, `/aftermath-revert`, `/aftermath-audit`, `/aftermath-log`, `/aftermath-checkpoint`, `/aftermath-init`.
- `aftermath init` detects stacks/test commands and writes `.aftermath/config.json` with `safePaths` (disposable artifacts) and `protectedPaths` (source, VCS, secrets, manifests), so destructive coverage is project-aware from the start.
- Keep `AFTERMATH.md` tiny (~dozen lines). Keep host adapters thin — all behavior lives in `skills/` + `hooks/`.
