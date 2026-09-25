# Aftermath — post-failure recovery skill for AI coding agents

[![skills.sh](https://skills.sh/b/moah0911/aftermath)](https://skills.sh/moah0911/aftermath)
[![npm](https://img.shields.io/npm/v/@moah0911%2Faftermath)](https://www.npmjs.com/package/@moah0911/aftermath)
[![license](https://img.shields.io/badge/license-MIT-green)](LICENSE)

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

## Install

Any agent (skills.sh):

```bash
npx skills add moah0911/aftermath -g -y
```

OpenCode via npm:

```json
{ "plugin": ["@moah0911/aftermath"] }
```

OpenCode via curl:

```bash
curl -fsSL https://raw.githubusercontent.com/moah0911/aftermath/main/scripts/install.sh \
  | bash -s --            # global: plugin + commands + skills
```

Claude Code via marketplace:

```
/plugin marketplace add moah0911/aftermath
/plugin install aftermath@aftermath
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
scripts/              # install.js + install.sh + consistency checks
tests/                # node:test suite (44 tests)
```

## Verify

```bash
npm test        # 44 tests
npm run check   # rule-copy + version alignment
```

## License

MIT — see `LICENSE`.
