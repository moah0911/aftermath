# Python parity tests for the afm (aftermath) ported init.
# Run: python3 -m unittest discover -s tests/python -v  (or: npm run test:py)
import contextlib
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "src"))

NODE = shutil.which("node")


def write(root: Path, rel: str, content: str) -> None:
    path = root / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def make_repo(
    root: Path,
    *,
    gitignore: bool = True,
    package_json: bool = False,
    pyproject: bool = False,
    makefile_test: bool = False,
    extra: dict | None = None,
) -> Path:
    root.mkdir(parents=True, exist_ok=True)
    (root / ".git").mkdir(exist_ok=True)
    if gitignore:
        write(
            root,
            ".gitignore",
            "node_modules/\ndist/\ncoverage/\n.venv/\n__pycache__/\n!dist/keep.md\n",
        )
    if package_json:
        write(
            root,
            "package.json",
            json.dumps(
                {
                    "name": "x",
                    "version": "1.0.0",
                    "scripts": {"test": "echo t", "build": "echo b"},
                }
            ),
        )
    if pyproject:
        write(root, "pyproject.toml", '[project]\nname = "x"\nversion = "0.0.1"\n')
    if makefile_test:
        write(root, "Makefile", "build:\n\t@true\n\ntest:\n\t@true\n")
    for rel, content in (extra or {}).items():
        write(root, rel, content)
    return root


def run_cli_capture(argv) -> tuple[int, str]:
    """Run afm.cli.cli() capturing stderr; returns (exit_code, stderr)."""
    from afm.cli import cli

    buf = io.StringIO()
    with contextlib.redirect_stderr(buf):
        code = cli(argv)
    return code, buf.getvalue()


class UnitTests(unittest.TestCase):
    """Ported unit coverage — mirrors the JS init.test.cjs shapes."""

    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="afm-units-"))

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    # --- argument parsing -------------------------------------------------
    def test_host_must_be_valid(self):
        out = self.tmp / "x"
        out.mkdir()
        code, err = run_cli_capture(["--host", "vscode", "--dir", str(out)])
        self.assertEqual(code, 1)
        self.assertIn("--host must be one of", err)

    def test_unknown_flag(self):
        out = self.tmp / "x2"
        out.mkdir()
        code, err = run_cli_capture(["--wat", "--dir", str(out)])
        self.assertEqual(code, 1)
        self.assertIn("unknown flag", err)

    def test_dir_needs_value(self):
        code, err = run_cli_capture(["--dir"])
        self.assertEqual(code, 1)
        self.assertIn("needs a value", err)

    def test_unexpected_positional(self):
        code, err = run_cli_capture(["extra"])
        self.assertEqual(code, 1)
        self.assertIn("unexpected argument", err)

    # --- root discovery ---------------------------------------------------
    def test_find_project_root_walks_to_git(self):
        from afm.detect import find_project_root

        repo = self.tmp / "repo"
        (repo / ".git").mkdir(parents=True)
        nested = repo / "packages" / "svc" / "deep"
        nested.mkdir(parents=True)
        self.assertEqual(find_project_root(nested), repo)

    def test_find_project_root_aftermath_anchor(self):
        from afm.detect import find_project_root

        repo = self.tmp / "aftermath-anchored"
        (repo / ".aftermath").mkdir(parents=True)
        nested = repo / "sub"
        nested.mkdir()
        self.assertEqual(find_project_root(nested), repo)

    def test_find_project_root_isolated(self):
        from afm.detect import find_project_root

        solo = self.tmp / "solo"
        solo.mkdir()
        self.assertEqual(find_project_root(solo), solo)

    # --- detection ----------------------------------------------------------
    def test_detect_node_stack(self):
        from afm.detect import detect_project

        repo = make_repo(self.tmp / "n", package_json=True)
        result = detect_project(repo)
        self.assertIn("node", result["stacks"])
        self.assertEqual(result["package_manager"], "npm")
        self.assertEqual(result["test_commands"], ["npm test"])
        self.assertEqual(result["build_commands"], ["npm run build"])

    def test_detect_python_stack(self):
        from afm.detect import detect_project

        repo = make_repo(self.tmp / "p", pyproject=True)
        result = detect_project(repo)
        self.assertIn("python", result["stacks"])
        self.assertEqual(result["test_commands"], ["python -m pytest"])
        self.assertEqual(result["build_commands"], ["python -m build"])

    def test_detect_package_managers(self):
        from afm.detect import detect_package_manager

        cases = {
            "pnpm-lock.yaml": "pnpm",
            "yarn.lock": "yarn",
            "bun.lockb": "bun",
            "bun.lock": "bun",
        }
        for lock, expected in cases.items():
            repo = make_repo(
                self.tmp / ("lock-" + lock.replace(".", "-")),
                package_json=True,
                gitignore=False,
            )
            write(repo, lock, "")
            self.assertEqual(detect_package_manager(repo), expected, msg=lock)
        repo = make_repo(self.tmp / "lock-plain", package_json=True, gitignore=False)
        self.assertEqual(detect_package_manager(repo), "npm")

    def test_makefile_detection_only_test_target(self):
        from afm.detect import detect_project

        with_test = make_repo(self.tmp / "mk1", makefile_test=True, gitignore=False)
        self.assertIn("make", detect_project(with_test)["stacks"])

        without = make_repo(self.tmp / "mk2", gitignore=False)
        write(without, "Makefile", "testing:\n\t@true\n")  # must NOT match ^test\s*:
        self.assertNotIn("make", detect_project(without)["stacks"])

    # --- artifacts / protected ----------------------------------------------
    def test_artifacts_from_gitignore(self):
        from afm.detect import detect_artifacts

        repo = make_repo(self.tmp / "art")
        for name in ("node_modules", "__pycache__"):
            (repo / name).mkdir()
        (repo / "dist").mkdir()
        write(repo, "dist/keep.md", "tracked!")  # negated child: keep.md is tracked
        result = detect_artifacts(repo)
        self.assertIn("node_modules", result)
        self.assertIn("__pycache__", result)
        self.assertNotIn("dist", result)  # has tracked content → not safe to wipe
        self.assertNotIn(".venv", result)  # ignored but directory absent

    def test_artifacts_negated_child_skips(self):
        from afm.detect import detect_artifacts

        repo = make_repo(self.tmp / "neg")
        write(repo, ".gitignore", "node_modules/\n!node_modules/pkg/\n")
        (repo / "node_modules").mkdir()
        self.assertNotIn("node_modules", detect_artifacts(repo))

    def test_artifacts_drops_non_directories(self):
        from afm.detect import detect_artifacts

        repo = make_repo(self.tmp / "file-art")
        write(repo, ".gitignore", "dist/\n")
        write(repo, "dist", "I am a file!")
        self.assertNotIn("dist", detect_artifacts(repo))

    def test_protected_paths(self):
        from afm.detect import detect_protected

        repo = make_repo(
            self.tmp / "prot", package_json=True, gitignore=False, extra={"a.pem": "x"}
        )
        result = detect_protected(repo)
        for expected in (".git", ".env*", "secrets*", "*.pem", "*.key", "package.json"):
            self.assertIn(expected, result)

    # --- config merge ---------------------------------------------------------
    def test_merge_preserves_user_arrays(self):
        from afm.config import merge_config

        existing = {
            "version": 1,
            "defaultMode": "full",
            "autoRevert": False,
            "stacks": ["user-stack"],
            "testCommands": ["user test"],
            "buildCommands": ["user build"],
            "safePaths": ["user-dist"],
            "protectedPaths": ["my-secret*"],
            "destructiveAllowlist": ["rm -rf dist"],
        }
        generated = {
            "version": 1,
            "defaultMode": "full",
            "autoRevert": False,
            "stacks": ["node"],
            "testCommands": ["npm test"],
            "buildCommands": ["npm run build"],
            "safePaths": ["node_modules", "dist"],
            "protectedPaths": [".git", ".env*"],
            "destructiveAllowlist": [],
        }
        merged = merge_config(existing, generated)
        self.assertEqual(merged["stacks"], ["user-stack"])
        self.assertEqual(merged["testCommands"], ["user test"])
        self.assertEqual(merged["safePaths"], ["user-dist"])
        self.assertEqual(merged["protectedPaths"], ["my-secret*", ".git", ".env*"])
        self.assertEqual(merged["destructiveAllowlist"], ["rm -rf dist"])

        forced = merge_config(existing, generated, force=True)
        self.assertEqual(forced["stacks"], ["node"])
        self.assertEqual(forced["safePaths"], ["node_modules", "dist"])

    # --- baseline ---------------------------------------------------------------
    def test_baseline_records_outcome(self):
        from afm.baseline import run_baseline

        repo = make_repo(self.tmp / "base", gitignore=False)
        baseline = run_baseline(repo, "true")
        self.assertEqual(baseline["status"], "passed")
        self.assertEqual(baseline["exitCode"], 0)
        self.assertRegex(baseline["ranAt"], r"Z$")

        repo2 = make_repo(self.tmp / "base2", gitignore=False)
        failing = run_baseline(repo2, "exit 3")
        self.assertEqual(failing["status"], "failed")
        self.assertEqual(failing["exitCode"], 3)
        written = json.loads(
            (repo2 / ".aftermath" / "baseline.json").read_text(encoding="utf-8")
        )
        self.assertEqual(written["status"], "failed")

    # --- end-to-end (python-only wiring against package assets) -----------------
    def test_cli_writes_config_and_rerun_preserves(self):
        from afm.cli import cli

        repo = make_repo(self.tmp / "e2e", package_json=True, pyproject=True)
        # Real artifact dirs so detection has something to pick up.
        (repo / "node_modules").mkdir()
        (repo / "coverage").mkdir()
        argv = ["--no-wire", "--dir", str(repo)]
        self.assertEqual(cli(argv), 0)
        config = json.loads(
            (repo / ".aftermath" / "config.json").read_text(encoding="utf-8")
        )
        self.assertEqual(config["version"], 1)
        self.assertEqual(config["stacks"], ["node", "python"])
        self.assertEqual(
            config["testCommands"], ["npm test", "python -m pytest"]
        )
        # safePaths: node_modules/dist/coverage ignored; dist has a tracked child.
        self.assertEqual(config["safePaths"], ["node_modules", "coverage"])

        user = dict(config)
        user["safePaths"] = ["node_modules"]
        write(repo, ".aftermath/config.json", json.dumps(user, indent=2))
        self.assertEqual(cli(argv), 0)
        again = json.loads(
            (repo / ".aftermath" / "config.json").read_text(encoding="utf-8")
        )
        self.assertEqual(again["safePaths"], ["node_modules"])

    def test_cli_dry_run_writes_nothing(self):
        from afm.cli import cli

        repo = make_repo(self.tmp / "dry", package_json=True)
        self.assertEqual(cli(["--dry-run", "--no-wire", "--dir", str(repo)]), 0)
        self.assertFalse((repo / ".aftermath").exists())

    def test_cli_wires_assets(self):
        from afm.cli import cli

        repo = make_repo(self.tmp / "wired", package_json=True)
        self.assertEqual(cli(["--dir", str(repo)]), 0)
        self.assertTrue((repo / ".opencode" / "plugins" / "aftermath.mjs").exists())
        self.assertTrue(
            (repo / ".opencode" / "plugins" / "aftermath-frontmatter.cjs").exists()
        )
        self.assertTrue((repo / ".opencode" / "commands" / "aftermath.md").exists())
        self.assertTrue((repo / "skills" / "aftermath" / "SKILL.md").exists())
        self.assertTrue((repo / "hooks" / "aftermath-config.js").exists())
        opencode_json = json.loads(
            (repo / "opencode.json").read_text(encoding="utf-8")
        )
        self.assertIn(
            "./.opencode/plugins/aftermath.mjs", opencode_json["plugin"]
        )
        self.assertEqual(
            opencode_json["$schema"], "https://opencode.ai/config.json"
        )
        # Idempotent: a second run changes nothing and stays green.
        self.assertEqual(cli(["--dir", str(repo)]), 0)


def run_via_cwd(commands: list, cwd: Path, env_extra: dict | None = None):
    env = dict(os.environ)
    if env_extra:
        env.update(env_extra)
    return subprocess.run(
        commands,
        cwd=cwd,
        capture_output=True,
        encoding="utf-8",
        timeout=120,
        env=env,
    )


@unittest.skipIf(NODE is None, "node not available for JS↔python parity")
class ParityTests(unittest.TestCase):
    """Compare node scripts/init.js --json and python afm init --json exactly."""

    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="afm-parity-"))

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    def make_fixtures(self) -> dict:
        fixtures = {
            "node-project": make_repo(self.tmp / "node-project", package_json=True),
            "python-project": make_repo(
                self.tmp / "python-project", pyproject=True
            ),
            "multi-stack": make_repo(
                self.tmp / "multi-stack",
                package_json=True,
                pyproject=True,
                makefile_test=True,
            ),
            "empty": make_repo(
                self.tmp / "empty",
                gitignore=False,
                extra={"gitkeep": ""},
            ),
        }
        shutil.rmtree(fixtures["empty"] / ".git")
        return fixtures

    def test_parity_on_fixtures(self):
        fixtures = self.make_fixtures()
        flag_sets = [
            ["--json", "--dry-run", "--run-tests"],
            ["--json", "--dry-run", "--no-wire"],
            ["--json", "--dry-run", "--force"],
        ]
        for name, cwd in fixtures.items():
            for extra in flag_sets:
                with self.subTest(fixture=name, extra=" ".join(extra)):
                    node_run = run_via_cwd(
                        ["node", str(REPO_ROOT / "scripts" / "init.js")] + extra,
                        cwd,
                    )
                    py_run = run_via_cwd(
                        [sys.executable, "-m", "afm", "init"] + extra,
                        cwd,
                        {"PYTHONPATH": str(REPO_ROOT / "src")},
                    )
                    self.assertEqual(node_run.returncode, 0, node_run.stderr)
                    self.assertEqual(py_run.returncode, 0, py_run.stderr)
                    node_json = self._json_part(node_run.stdout)
                    py_json = self._json_part(py_run.stdout)
                    self.assertEqual(node_json["config"], py_json["config"])
                    self.assertEqual(node_json["actions"], py_json["actions"])
                    self.assertEqual(
                        str(node_json["root"]), str(py_json["root"])
                    )
                    if node_json["baseline"] is not None:
                        # Dry-run never populates a baseline on either side.
                        self.fail("dry-run must not produce a baseline")

    @staticmethod
    def _json_part(text: str) -> dict:
        start = text.index("{")
        return json.loads(text[start:])


if __name__ == "__main__":
    unittest.main()
