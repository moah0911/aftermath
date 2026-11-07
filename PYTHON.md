# afm — aftermath recovery for Python toolchains

The npm/JS distribution of aftermath is [@after-math/aftermath](https://www.npmjs.com/package/@after-math/aftermath)
(source: [moah0911/aftermath](https://github.com/moah0911/aftermath)). This wheel,
**afm-recovery**, brings the same `init` flow to Python environments with no
Node.js requirement.

## Install

```sh
# ephemeral, no install step
uvx afm-recovery init

# or as a persistent CLI (commands: `afm` and `afm-recovery`)
pipx install afm-recovery
```

## Use

```sh
afm init                    # detect stack + write .aftermath/config.json
afm init --dry-run --json
afm init --run-tests        # also record a baseline (opt-in)
afm init --no-wire          # config only, no host wiring
afm init --host opencode    # limit wiring to one host
```

What it does (mirrors the node CLI — parity is enforced by tests):

1. Detects stacks (node / python / rust / go / ruby / php / java / make),
   the package manager, and test + build commands.
2. Reads `.gitignore` to find disposable build artifacts → `safePaths`; marks
   source dirs + manifests as `protectedPaths`.
3. Writes `.aftermath/config.json`.
4. Wires the OpenCode plugin standalone: copies plugin, commands, hooks, and
   skills into the project and registers the plugin entry in `opencode.json`.
   Self-contained — no git, no network, no node at run time.
5. With `--run-tests`: runs the detected test command once and records
   `.aftermath/baseline.json` as the green reference for recovery.

Python 3.10+. Zero runtime dependencies, stdlib only — matching the JS CLI.
Claude Code / Codex wiring stays marketplace-driven and is printed as
instructions.
