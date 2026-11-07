"""OpenCode project wiring for `afm init` — mirrors install.js wireOpencode."""

import json
import shutil
from pathlib import Path

ASSETS = Path(__file__).parent / "assets"

PLUGIN_BASENAME = "aftermath.mjs"
SCHEMA_URL = "https://opencode.ai/config.json"

# Copied into the target project so the self-locating plugin (which resolves
# ../../skills and ../commands relative to its own file) works standalone.
PLUGIN_FILES = ["aftermath.mjs", "aftermath-frontmatter.cjs"]


def load_opencode_json(path: Path) -> dict:
    try:
        cfg = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(cfg, dict):
            raise ValueError(f"{path} is not a JSON object — fix it first")
        return cfg
    except FileNotFoundError:
        return {}


def _ensure_plugin_entry(cfg: dict, spec: str) -> tuple:
    plugins = cfg.get("plugin")
    plugins = plugins if isinstance(plugins, list) else []
    for entry in plugins:
        existing = entry[0] if isinstance(entry, list) else entry
        if isinstance(existing, str) and existing == spec:
            return False, plugins
    return True, [*plugins, spec]


def _remove_plugin_entry(cfg: dict) -> tuple:
    plugins = cfg.get("plugin")
    plugins = plugins if isinstance(plugins, list) else []
    next_list = [
        e
        for e in plugins
        if "aftermath"
        not in (e if isinstance(e, str) else e[0] if isinstance(e, list) else "")
    ]
    return len(next_list) != len(plugins), next_list


def _copy_file(src: Path, dest: Path, log, dry_run: bool) -> str:
    """Returns 'copied' | 'in-place' — same idempotent semantics as install.js."""
    try:
        if dest.exists() and dest.read_bytes() == src.read_bytes():
            log(f"already in place: {dest}")
            return "in-place"
        if dest.exists():
            log(f"skip (real file differs, left alone): {dest}")
            return "skip"
    except OSError:
        pass
    log(f"copy: {dest} ← {src}")
    if not dry_run:
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, dest)
    return "copied"


def copy_plugin(root: Path, log, dry_run: bool) -> tuple:
    plugin_dir = root / ".opencode" / "plugins"
    copied = 0
    for name in PLUGIN_FILES:
        src = ASSETS / ".opencode" / "plugins" / name
        dest = plugin_dir / name
        if _copy_file(src, dest, log, dry_run) == "copied":
            copied += 1
    return copied


def copy_commands(root: Path, log, dry_run: bool) -> tuple:
    cmd_src = ASSETS / ".opencode" / "commands"
    cmd_dest = root / ".opencode" / "commands"
    files = sorted(p.name for p in cmd_src.iterdir()) if cmd_src.is_dir() else []
    copied = 0
    skipped = 0
    for name in files:
        dest = cmd_dest / name
        outcome = _copy_file(cmd_src / name, dest, log, dry_run)
        if outcome == "copied":
            copied += 1
        else:
            skipped += 1
    return copied, skipped


def copy_skills(root: Path, log, dry_run: bool) -> int:
    skills_src = ASSETS / "skills"
    copied = 0
    if not skills_src.is_dir():
        return copied
    for skill in sorted(skills_src.iterdir()):
        if not skill.is_dir():
            continue
        for src in sorted(skill.rglob("*")):
            if src.is_dir():
                continue
            dest = root / "skills" / skill.name / src.relative_to(skill)
            if _copy_file(src, dest, log, dry_run) == "copied":
                copied += 1
    return copied


def copy_hooks(root: Path, log, dry_run: bool) -> int:
    hooks_src = ASSETS / "hooks"
    copied = 0
    if not hooks_src.is_dir():
        return copied
    for src in sorted(hooks_src.rglob("*")):
        if src.is_dir():
            continue
        dest = root / "hooks" / src.relative_to(hooks_src)
        if _copy_file(src, dest, log, dry_run) == "copied":
            copied += 1
    return copied


def write_opencode_json(root: Path, log, dry_run: bool) -> None:
    config_file = root / "opencode.json"
    cfg = load_opencode_json(config_file)

    if not cfg.get("$schema"):
        cfg["$schema"] = SCHEMA_URL

    # Portable relative spec — the plugin is (or will be) at the same path here.
    spec = "./.opencode/plugins/" + PLUGIN_BASENAME
    changed, plugins = _ensure_plugin_entry(cfg, spec)
    if changed:
        log(f"add plugin to {config_file}: {spec}")
        if not dry_run:
            cfg["plugin"] = plugins
            config_file.write_text(
                json.dumps(cfg, indent=2) + "\n", encoding="utf-8"
            )
    else:
        log("plugin entry already present")


def wire_project(root: Path, log, dry_run: bool) -> None:
    """Project-scope wiring: stage assets, then point opencode.json at them."""
    copy_plugin(root, log, dry_run)
    copy_skills(root, log, dry_run)
    copy_hooks(root, log, dry_run)
    copied, skipped = copy_commands(root, log, dry_run)
    log(f"commands: {copied} copied, {skipped} already in place")
    write_opencode_json(root, log, dry_run)
    log("skills auto-register via the plugin config hook — no action needed")


def print_host_steps(host: str, log) -> None:
    if host in ("all", "claude"):
        log("Claude Code (interactive — run these two prompts):")
        log("  /plugin marketplace add moah0911/aftermath")
        log("  /plugin install aftermath@aftermath")
    if host in ("all", "codex"):
        log("Codex (single command):")
        log(
            "  codex plugin marketplace add https://github.com/moah0911/aftermath"
            " --ref main && codex plugin add aftermath@aftermath"
        )
