"""CLI — mirrors scripts/cli.js + scripts/init.js: `afm init [options]`."""

import argparse
import json
import sys
from pathlib import Path

from afm import __version__
from afm.baseline import run_baseline
from afm.config import build_config, merge_config, read_config_file, write_config
from afm.detect import detect_project, find_project_root
from afm.wiring import print_host_steps, wire_project

HOSTS = ["opencode", "claude", "codex", "all"]


def usage() -> str:
    return "\n".join(
        [
            "Usage: afm init [options]",
            "",
            "  --dir <path>      project directory (default: cwd)",
            "  --dry-run         print actions, write nothing",
            "  --no-wire         write config without installing host wiring",
            "  --host <h>        opencode|claude|codex|all (default: all)",
            "  --run-tests       run the detected test command once and record a baseline",
            "  --force           replace generated arrays instead of preserving existing ones",
            "  --json            machine-readable output",
            "  -h, --help        this text",
        ]
    )


class _Parser(argparse.ArgumentParser):
    # Mirror init.js: never exit(2) on parse errors — raise so cli() formats
    # the message identically to the node implementation.
    def error(self, message):
        raise ValueError(translate_error(message))


def translate_error(message: str) -> str:
    if ": expected one argument" in message or message.endswith("an argument"):
        flag = message.split(":")[0].replace("argument", "").strip()
        return f"{flag} needs a value"
    if message.startswith("unrecognized"):
        arg = message.rsplit(" ", 1)[-1]
        if arg.startswith("-"):
            return f"unknown flag: {arg}"
        return f"unexpected argument: {arg}"
    return message


def parse_args(argv):
    parser = _Parser(prog="afm init", add_help=False, allow_abbrev=False)
    parser.add_argument("--dir", default=None)
    parser.add_argument("--host", default="all")
    parser.add_argument("--dry-run", action="store_true", dest="dry_run")
    parser.add_argument("--no-wire", action="store_true", dest="no_wire")
    parser.add_argument("--run-tests", action="store_true", dest="run_tests")
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--json", action="store_true", dest="json")
    parser.add_argument("-h", "--help", action="store_true", dest="help")

    raw = parser.parse_args(argv)

    for flag in ("dir", "host"):
        value = getattr(raw, flag)
        if value is not None and isinstance(value, str) and value.startswith("--"):
            raise ValueError(f"--{flag} needs a value")
    if raw.host not in ["opencode", "claude", "codex", "all"]:
        raise ValueError("--host must be one of: opencode|claude|codex|all")
    if raw.dir is not None and raw.dir.startswith("--"):
        raise ValueError("--dir needs a value")
    return raw


def main(argv) -> int:
    opts = parse_args(argv)
    if opts.help:
        print(usage())
        return 0

    start = Path(opts.dir).resolve() if opts.dir else Path.cwd()
    try:
        if not start.is_dir():
            raise ValueError(f"--dir is not a directory: {start}")
    except OSError:
        raise ValueError(f"--dir does not exist: {start}") from None

    root = find_project_root(start)
    project = detect_project(root)
    generated = build_config(project)
    existing = read_config_file(root)
    config = merge_config(existing, generated, force=opts.force)
    actions = []

    if opts.dry_run:
        actions.append("would write .aftermath/config.json")
    else:
        write_config(root, config)
        actions.append("wrote .aftermath/config.json")

    if opts.no_wire:
        actions.append("host wiring skipped")
    elif opts.dry_run:
        actions.append("would wire hosts: " + opts.host)
    else:
        install_logs = []
        wire_project(root, install_logs.append, opts.dry_run)
        print_host_steps(opts.host, install_logs.append)
        actions.extend(install_logs)

    baseline = None
    if opts.run_tests:
        if not project["test_commands"]:
            actions.append("no test command detected; baseline skipped")
        elif opts.dry_run:
            actions.append("would run baseline: " + project["test_commands"][0])
        else:
            baseline = run_baseline(root, project["test_commands"][0])
            actions.append("baseline: " + baseline["status"])

    if opts.json:
        print(
            json.dumps(
                {
                    "root": str(root),
                    "config": config,
                    "actions": actions,
                    "baseline": baseline,
                },
                indent=2,
            )
        )
        return 0

    print("aftermath init — " + str(root))
    print("stacks: " + (", ".join(project["stacks"]) or "none detected"))
    print("test: " + (" · ".join(config["testCommands"]) or "none detected"))
    print("build: " + (" · ".join(config["buildCommands"]) or "none detected"))
    print("safe paths: " + (", ".join(config["safePaths"]) or "none"))
    print("protected: " + (", ".join(config["protectedPaths"]) or "none"))
    for action in actions:
        print("· " + action)
    print("next: run the detected test command once, then /aftermath-status")
    return 0


def cli(argv) -> int:
    try:
        return main(argv)
    except (ValueError, OSError, json.JSONDecodeError) as error:
        message = getattr(error, "message", None) or str(error)
        print("aftermath init failed: " + message, file=sys.stderr)
        return 1


def run() -> None:
    """Console-script entry point (afm / afm-recovery)."""
    argv = sys.argv[1:]
    if not argv or argv[0] in ("-h", "--help"):
        print(
            "\n".join(
                [
                    "Usage: afm <command> [options]",
                    "",
                    "  init       initialize destructive-safe recovery for a project",
                    "",
                    "Run `afm init --help` for details.",
                    "Node users: the full `aftermath install` flow ships via npm",
                    "(`npx @after-math/aftermath init`).",
                ]
            )
        )
        raise SystemExit(0)
    if argv[0] == "init":
        raise SystemExit(cli(argv[1:]))
    print("afm: unknown command: " + argv[0], file=sys.stderr)
    print("Usage: afm init [options]", file=sys.stderr)
    raise SystemExit(1)


if __name__ == "__main__":
    run()
