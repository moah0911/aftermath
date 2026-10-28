# Project initialization (`aftermath init`)

`aftermath init` gives a project destructive-safe coverage from its first session. It
detects the stack and test/build commands, records which paths are disposable
artifacts, records which paths must never be deleted, and writes
`.aftermath/config.json`. It never runs destructive commands.

## Quick start

```bash
npx @moah0911/aftermath init                 # detect + write config + wire OpenCode
npx @moah0911/aftermath init --dry-run --json
npx @moah0911/aftermath init --no-wire       # config only
npx @moah0911/aftermath init --run-tests     # also record a baseline (opt-in)
```

From a checkout, use `node scripts/init.js` with the same flags. The slash command
`/aftermath-init` runs the same flow and summarizes the result.

## Flags

| Flag | Effect |
|------|--------|
| `--dir <path>` | Project directory (default: cwd). Walks up to `.git` or `.aftermath`. |
| `--dry-run` | Print the config and actions; write and run nothing. |
| `--no-wire` | Write config without installing host wiring. |
| `--host <h>` | `opencode`, `claude`, `codex`, or `all` (default `all`). |
| `--run-tests` | Run the first detected test command once and write `.aftermath/baseline.json`. |
| `--force` | Replace generated arrays instead of preserving existing ones. |
| `--json` | Machine-readable output. |
| `-h`, `--help` | Usage. |

## Detection

| Stack | Trigger files | Default test command |
|-------|---------------|----------------------|
| Node | `package.json` + lockfile | npm/pnpm/yarn/bun `test` script |
| Python | `pyproject.toml`, `requirements.txt`, `pytest.ini`, `tox.ini`, `setup.py` | `nox`, `tox`, or `python -m pytest` |
| Rust | `Cargo.toml` | `cargo test` |
| Go | `go.mod` | `go test ./...` |
| Ruby | `Gemfile` | `bin/rails test`, `bundle exec rspec`, or `bundle exec rake test` |
| PHP | `composer.json` | `php artisan test` or `vendor/bin/phpunit` |
| Java | `pom.xml`, `gradlew`, `build.gradle` | `mvn test` or Gradle `test` |
| Make | `Makefile` with a `test:` target | `make test` |

Multiple stacks are supported. Build commands are detected alongside test commands.

## Generated config

```json
{
  "version": 1,
  "defaultMode": "full",
  "autoRevert": false,
  "stacks": ["node"],
  "packageManager": "npm",
  "testCommands": ["npm test"],
  "buildCommands": ["npm run build"],
  "safePaths": ["node_modules", "dist", "coverage"],
  "protectedPaths": [".git", ".env*", "secrets*", "*.pem", "*.key", "src", "tests", "package.json"],
  "destructiveAllowlist": []
}
```

- `safePaths` come from a curated artifact list, and only when the directory exists
  and is gitignored. A negated tracked child (`!dist/keep.txt`) disables the whole
  directory.
- `protectedPaths` always include `.git`, `.env*`, `secrets*`, `*.pem`, and `*.key`.
  Existing source/test directories and manifests/lockfiles are added.
- Init never enables `autoRevert`.
- Existing values are preserved. `protectedPaths`, `testCommands`, `buildCommands`,
  and `destructiveAllowlist` union with global config; project scalars override
  global scalars. `--force` replaces generated arrays.

## Destructive policy

A filesystem delete is allowed only when **every** target is a literal, relative path
inside the project, under a `safePath`, and not under a `protectedPath`.

| Decision | Reason |
|----------|--------|
| Allow | `safe-artifact` (e.g. `rm -rf node_modules`) or `explicit-allowlist` |
| Block | `protected-path`, `unknown-target`, `dynamic-target`, `outside-project`, `complex-shell`, `non-path-destructive`, `no-project` |

Non-path destructive commands (force push, `reset --hard`, `clean -f`, database drops,
prune, destroy) always block unless explicitly allowlisted. Dynamic targets (`$HOME`,
globs), `..` traversal, absolute paths outside the project, and symlinks that resolve
outside safe paths are blocked. Policy v1 parses `rm -r/-rf` and `find ... -delete`;
other destructive commands stay blocked.

The same policy runs in the OpenCode plugin and in the Claude Code / Codex
`PreToolUse` hook (Bash). Those hosts also use `PreToolUse` to freeze Edit/Write/
MultiEdit after an unresolved failure, and `PostToolUse` / `UserPromptSubmit` to
deliver failure and correction reminders. At `lite`/`off`, the OpenCode plugin is
advisory or disabled; the Claude/Codex hooks allow the command because those hosts
have no advisory channel.

## Baseline

`--run-tests` executes the first detected test command with a timeout and records
`.aftermath/baseline.json`:

```json
{
  "command": "npm test",
  "status": "passed",
  "exitCode": 0,
  "commit": "abc123...",
  "ranAt": "2026-10-28T12:00:00.000Z"
}
```

The baseline is informational; it does not enable auto-revert or change the mode.

## Safety guarantees

- Init writes only `.aftermath/config.json`, optional host wiring, and the optional
  baseline. It does not delete files or run tests unless `--run-tests` is passed.
- Unknown or sensitive paths remain blocked by default.
- `--dry-run` writes and runs nothing.
- `--no-wire` avoids host configuration changes.

## Limitations

- Artifact detection is top-level and curated; nested monorepo `node_modules` are not
  auto-allowed. Add them explicitly under `safePaths` if needed.
- A `.gitignore` entry alone is not trusted; only curated artifact names are eligible.
- Policy parsing is deliberately conservative. If a command is blocked unexpectedly,
  narrow the command or add a narrow `destructiveAllowlist` entry.
