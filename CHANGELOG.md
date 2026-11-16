# Changelog

All notable changes to Aftermath. Versions are published to npm as
[`@after.math/aftermath`](https://www.npmjs.com/package/@after.math/aftermath)
(the GitHub source of truth is [moah0911/aftermath](https://github.com/moah0911/aftermath)).

npm versions are immutable — the table below lists what each line does and
where it breaks.

## 0.7.0 — current

**Init wires only the agent you are running in.** `--host` now defaults to
`auto` (detected via `CLAUDECODE` / `CODEX_*` env signals, otherwise
`opencode`), instead of `all`. Previously an OpenCode session shelled out to
`claude plugin install` and `codex plugin marketplace add` — each cloning a
marketplace over the network — and, because `wireProject` never passed
`project: true`, those installs landed in the user's global `~/.claude` and
`~/.codex` instead of the project.

- `--host auto|opencode|claude|codex|all`, overridable with `AFTERMATH_HOST`
- any Claude/Codex install triggered by `init` is now project-scoped
  (`.claude/settings.json`), never global config
- `mergeConfig` regenerates **empty** arrays, so a re-run picks up newly
  detected test commands / safe paths without `--force`
- `init` in an OpenCode session: 0.19s, zero agent-CLI calls
- the Python port (`afm-recovery`) changed in lockstep; node↔python parity
  is enforced by tests

## 0.6.1 — metadata

- `repository`, `homepage`, `bugs`, `author` added — the npm page had no
  GitHub link
- `publishConfig.access: public` — a scoped package otherwise defaults to
  *restricted* access, which needs a paid npm plan

## 0.6.0 — `npm i` wires the agents

- `postinstall` / `postuninstall` lifecycle hooks: `npm i @after.math/aftermath`
  wires every detected agent at project scope (OpenCode assets copied with a
  relative spec, Claude Code via its marketplace CLI, Codex via its CLI)
- `aftermath-install` gained a durable user-scope OpenCode runtime under
  `~/.config/aftermath/runtime` instead of symlinking a cache/clone
- `.claude-plugin/plugin.json` and `.codex-plugin/plugin.json` fixed:
  `author` must be an object and `skills`/`hooks` must start with `./` —
  Claude rejected the old shape with *"invalid manifest file"*
- agent CLI calls now run with `cwd` = project root (npm runs lifecycle
  scripts in the package directory, so Claude wrote its project-scope enable
  entry into `node_modules`)
- `claude plugin enable` added — installing a project-scope plugin leaves it
  disabled
- the test suite became hermetic: it previously executed the real
  `claude`/`codex` binaries and installed on the developer's machine

## 0.5.3

- Codex marketplace command no longer passed `--ref undefined` when driven
  from `init`

## 0.5.2

- project wiring stages **copies** of the plugin, commands, hooks, and skills
  into the project and registers the portable
  `./.opencode/plugins/aftermath.mjs` spec. Before this, `opencode.json`
  pointed at an absolute path inside the npm/npx cache — broken as soon as
  npm pruned it.
- `printHostSteps` arity fixed (a real `init` crashed with
  *"log is not a function"* after wiring)

## 0.5.1 — first release

- first publication of `@after.math/aftermath`
- known issues: the npx-cache plugin path above, and the `printHostSteps`
  crash — both fixed in 0.5.2

## Unreleased (repo only)

- CI publish workflow is idempotent: it skips when the version is already on
  npm, and skips when no `npm_token` secret is configured
- GitHub Packages channel removed (it re-scopes to the repo owner, so it
  could only host a second, confusing name for the same package)
- `CHANGELOG.md` and the README version-status callout
