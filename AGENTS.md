# AGENTS.md — Aftermath (post-failure recovery)

This repo ships Aftermath. The canonical always-on ruleset is `AFTERMATH.md` — the six-rung recovery ladder. OpenCode also injects it every turn via `.opencode/plugins/aftermath.mjs` at the active intensity (`lite` / `full` / `ultra` / `off`, default `full`).

- After any failure, stop at the first rung of `AFTERMATH.md` that holds. Revert cheap damage instead of patching forward.
- Honesty under pressure: never hide a break, never silently revert, never invent an unverified root cause.
- On-demand skills live in `skills/` (loaded only when their failure category fires): `aftermath`, `test-regression`, `retry-loop`, `destructive-action`.
- Slash commands: `/aftermath [lite|full|ultra|off]`, `/aftermath-status`, `/aftermath-revert`, `/aftermath-audit`, `/aftermath-log`.
- Keep `AFTERMATH.md` tiny (~dozen lines). Keep host adapters thin — all behavior lives in `skills/` + `hooks/`.
