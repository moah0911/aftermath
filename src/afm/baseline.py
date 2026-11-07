"""Baseline test run — mirrors scripts/init.js runBaseline()."""

import json
import os
import subprocess
from datetime import datetime, timezone
from pathlib import Path


def _git_head(root: Path):
    try:
        out = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=root,
            capture_output=True,
            encoding="utf-8",
            timeout=30,
        )
        return out.stdout.strip() if out.returncode == 0 else None
    except (OSError, subprocess.SubprocessError):
        return None


def _now_iso() -> str:
    # Match JS new Date().toISOString(): millisecond precision, trailing Z.
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def run_baseline(root: Path, command: str, *, timeout: int = 300000) -> dict:
    env = {k: v for k, v in os.environ.items() if k != "NODE_V8_COVERAGE"}
    status = "passed"
    exit_code = 0
    try:
        result = subprocess.run(
            command,
            cwd=root,
            shell=True,
            capture_output=True,
            encoding="utf-8",
            timeout=timeout / 1000,
            env=env,
        )
        if result.returncode != 0:
            status = "failed"
            exit_code = result.returncode
    except subprocess.TimeoutExpired:
        status = "failed"
        exit_code = None
    except OSError:
        status = "failed"
        exit_code = None

    baseline = {
        "command": command,
        "status": status,
        "exitCode": exit_code,
        "commit": _git_head(root),
        "ranAt": _now_iso(),
    }
    baseline_dir = root / ".aftermath"
    baseline_dir.mkdir(parents=True, exist_ok=True)
    (baseline_dir / "baseline.json").write_text(
        json.dumps(baseline, indent=2) + "\n", encoding="utf-8"
    )
    return baseline
