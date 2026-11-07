# Guards the wheel's vendored runtime assets and the version sync.
# If a test fails here, run scripts/sync-afm-assets.sh (or re-copy) and publish:
# the shipped assets must byte-match the repo's live OpenCode wiring.
import json
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
SRC_ASSETS = REPO_ROOT / "src" / "afm" / "assets"

BUNDLED = [
    "SKILL.md",
    "AFTERMATH.md",
    ".opencode/plugins/aftermath.mjs",
    ".opencode/plugins/aftermath-frontmatter.cjs",
    "hooks/aftermath-checkpoints.cjs",
    "hooks/aftermath-config.js",
    "hooks/aftermath-destructive-policy.cjs",
    "hooks/aftermath-instructions.js",
    "hooks/aftermath-session-state.cjs",
    "hooks/aftermath-signals.cjs",
    "hooks/claude-codex-hooks.json",
    "hooks/post-tool-use.cjs",
    "hooks/pre-tool-use.cjs",
    "hooks/session-start.cjs",
    "hooks/user-prompt-submit.cjs",
    "skills/aftermath/SKILL.md",
    "skills/build-failure/SKILL.md",
    "skills/dependency-failure/SKILL.md",
    "skills/destructive-action/SKILL.md",
    "skills/flaky-test/SKILL.md",
    "skills/merge-conflict/SKILL.md",
    "skills/retry-loop/SKILL.md",
    "skills/test-regression/SKILL.md",
]


class AssetIntegrityTests(unittest.TestCase):
    def test_version_matches_npm_package(self):
        py_version = json.loads(
            (REPO_ROOT / "pyproject.toml").read_text(encoding="utf-8").split("[project.urls]")[0].split('version = "')[1].split('"')[0]
        ) if False else None
        # pyproject is TOML, not JSON — parse the version line directly.
        text = (REPO_ROOT / "pyproject.toml").read_text(encoding="utf-8")
        line = next(l for l in text.splitlines() if l.startswith("version = "))
        py_version = line.split('"')[1]
        npm_version = json.loads(
            (REPO_ROOT / "package.json").read_text(encoding="utf-8")
        )["version"]
        self.assertEqual(py_version, npm_version)

    def test_bundled_assets_match_repo(self):
        for rel in BUNDLED:
            with self.subTest(asset=rel):
                src = REPO_ROOT / rel
                bundled = SRC_ASSETS / rel
                self.assertTrue(src.exists(), f"missing repo source: {rel}")
                self.assertTrue(bundled.exists(), f"missing bundled copy: {rel}")
                self.assertEqual(
                    src.read_bytes(),
                    bundled.read_bytes(),
                    f"asset drift for {rel} — re-sync src/afm/assets",
                )

    def test_bundle_is_complete_for_standalone_wiring(self):
        # The OpenCode plugin resolves skills/ and hooks/ relative to its own
        # file — everything it requires at runtime must ship in the wheel.
        required_dirs = ["skills", "hooks", ".opencode/plugins", ".opencode/commands"]
        for rel in required_dirs:
            self.assertTrue((SRC_ASSETS / rel).is_dir(), rel)
        commands = list((SRC_ASSETS / ".opencode" / "commands").glob("*.md"))
        self.assertGreaterEqual(len(commands), 7)


if __name__ == "__main__":
    unittest.main()
