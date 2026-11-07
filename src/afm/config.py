"""Config build / merge / IO — mirrors scripts/init.js (buildConfig, mergeConfig)."""

import json
from pathlib import Path

from afm import CONFIG_VERSION
from afm.detect import detect_artifacts, detect_project, detect_protected


def build_config(project: dict) -> dict:
    return {
        "version": CONFIG_VERSION,
        "defaultMode": "full",
        "autoRevert": False,
        "stacks": project["stacks"],
        "packageManager": project["package_manager"],
        "testCommands": project["test_commands"],
        "buildCommands": project["build_commands"],
        "safePaths": detect_artifacts(project["root"]),
        "protectedPaths": detect_protected(project["root"]),
        "destructiveAllowlist": [],
    }


def merge_config(existing: dict, generated: dict, *, force: bool = False) -> dict:
    merged = dict(existing)
    if not isinstance(merged.get("version"), int):
        merged["version"] = generated["version"]
    if not isinstance(merged.get("defaultMode"), str):
        merged["defaultMode"] = generated.get("defaultMode")
    if not isinstance(merged.get("autoRevert"), bool):
        merged["autoRevert"] = generated.get("autoRevert")
    if not isinstance(merged.get("packageManager"), str):
        merged["packageManager"] = generated.get("packageManager")
    for key in ("stacks", "testCommands", "buildCommands", "safePaths"):
        if force or not isinstance(merged.get(key), list):
            merged[key] = generated.get(key)
    if force or not isinstance(merged.get("protectedPaths"), list):
        merged["protectedPaths"] = generated.get("protectedPaths")
    else:
        merged["protectedPaths"] = _dedupe(
            list(merged["protectedPaths"]) + list(generated["protectedPaths"])
        )
    if not isinstance(merged.get("destructiveAllowlist"), list):
        merged["destructiveAllowlist"] = []
    return merged


def _dedupe(items):
    out = []
    for item in items:
        if item and item not in out:
            out.append(item)
    return out


def read_config_file(dir: Path) -> dict:
    from afm.detect import read_json

    return read_json(dir / ".aftermath" / "config.json")


def write_config(dir: Path, config: dict) -> None:
    config_dir = dir / ".aftermath"
    config_dir.mkdir(parents=True, exist_ok=True)
    (config_dir / "config.json").write_text(
        json.dumps(config, indent=2) + "\n", encoding="utf-8"
    )
