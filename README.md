# Aftermath — post-failure recovery skill for AI coding agents

Most agent skills teach how to build. Aftermath teaches how to **stop and recover** when something already broke: a test suite goes green → red, the same error recurs, a destructive command looms, or the user says "you broke it".

## The ladder (`AFTERMATH.md`)

After any failure, stop at the first rung that holds:

1. Uncommitted / one file / cheap to undo? → Revert now. Do not patch forward.
2. Last-known-good exists? → Diff it, isolate one change, revert just that.
3. 2nd+ failed attempt at the same fix? → State exact error, state theory, ask.
4. Next action irreversible? → Confirm state explicitly. Never assume.
5. Filling a gap with a guess? → Say so out loud.
6. User just corrected you? → Do not defend. Find the diff. Fix only that.

Honesty under pressure: never hide a break, never silently revert, never invent an unverified root cause.

## Intensities

| Level | Behavior |
|-------|----------|
| `lite` | Flags the problem, suggests the revert, lets the user decide |
| `full` | Default. Stops forward motion, runs the diff/isolate diagnostic, asks before the next edit |
| `ultra` | Auto-reverts cheap uncommitted damage to last-known-good, then reports what was undone and why |
| `off` | Disabled |

Switch with `/aftermath [lite|full|ultra|off]`.

## Slash commands

- `/aftermath-status` — what changed since last-known-good, in plain terms
- `/aftermath-revert` — undo the last change, nothing more
- `/aftermath-audit` — scan the diff for scope creep
- `/aftermath-log` — append a one-line postmortem to `AFTERMATH.log`

## Install (OpenCode)

```bash
curl -fsSL https://raw.githubusercontent.com/moah0911/aftermath/main/scripts/install.sh \
  | bash -s --            # global: plugin + commands + skills
```

Or from a clone (same flags, plus `--source` to skip cloning):

```bash
git clone https://github.com/moah0911/aftermath
node aftermath/scripts/install.js            # global: plugin + commands + skills
node aftermath/scripts/install.js --project  # or: wire the current project only
```

Or wire manually:

```json
{ "plugin": ["./.opencode/plugins/aftermath.mjs"] }
```

Restart OpenCode after adding. Also works from a checkout on Claude Code / Codex via the lifecycle hooks in `hooks/` — see `docs/agent-portability.md`. `AFTERMATH_DEFAULT_MODE` env var or `~/.config/aftermath/config.json` sets the default level.

## Layout

```
AFTERMATH.md          # the ladder — always loaded, ~dozen lines
hooks/                # shared instruction builder, mode config, signal detectors, host hooks
skills/               # aftermath + test-regression + retry-loop + destructive-action
commands/             # portable slash commands (mirrored to .opencode/commands/)
.opencode/plugins/   # server plugin (hybrid: always-on injection + failure tripwires)
tests/                # node:test suite (30 tests)
```

## Verify

```bash
npm test        # 30 tests
npm run check   # rule-copy alignment (AFTERMATH.md ↔ skills ↔ AGENTS.md)
```

## License

MIT — see `LICENSE`.
