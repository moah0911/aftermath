"""afm — aftermath recovery installer for Python toolchains.

`afm init` ports scripts/init.js: detect stacks/test/build commands and
disposable artifacts, write .aftermath/config.json, wire the OpenCode plugin,
and optionally record a test baseline. Stdlib only; no dependencies.

The OpenCode runtime assets (plugin, commands, hooks, skills) ship as package
data under afm/assets/ and are copied into the target project on init.
"""

__version__ = "0.5.2"
CONFIG_VERSION = 1

ALWAYS_PROTECTED = [".git", ".env*", "secrets*", "*.pem", "*.key"]
