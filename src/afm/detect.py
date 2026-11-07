"""Stack / artifact / protected-path detection — mirrors scripts/init.js."""

import json
import re
from pathlib import Path

ARTIFACT_NAMES = [
    "node_modules",
    "dist",
    "build",
    "out",
    "coverage",
    ".next",
    ".nuxt",
    "target",
    ".turbo",
    ".cache",
    "__pycache__",
    ".pytest_cache",
    ".venv",
    "venv",
]

SOURCE_DIRS = ["src", "app", "lib", "packages", "services", "tests", "test", "spec"]

MANIFESTS = [
    "package.json",
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "bun.lockb",
    "pyproject.toml",
    "requirements.txt",
    "Cargo.toml",
    "Cargo.lock",
    "go.mod",
    "go.sum",
    "Gemfile",
    "Gemfile.lock",
    "composer.json",
    "composer.lock",
    "pom.xml",
    "build.gradle",
    "settings.gradle",
    "Makefile",
]


def exists(dir: Path, name: str) -> bool:
    try:
        return (dir / name).exists()
    except OSError:
        return False


def read_json(file: Path):
    """Tolerant JSON loader: whitespace/BOM and non-object values map to {}."""
    try:
        text = file.read_text(encoding="utf-8-sig")
        value = json.loads(text)
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError):
        return {}


def find_project_root(start: Path) -> Path:
    """Walk up to the nearest directory containing .git or .aftermath."""
    start = Path(start).resolve()
    d = start
    while True:
        if (d / ".git").exists() or (d / ".aftermath").exists():
            return d
        parent = d.parent
        if parent == d:
            return start
        d = parent


def _dedupe(items):
    out = []
    for item in items:
        if item and item not in out:
            out.append(item)
    return out


def detect_package_manager(dir: Path) -> str:
    if exists(dir, "pnpm-lock.yaml"):
        return "pnpm"
    if exists(dir, "yarn.lock"):
        return "yarn"
    if exists(dir, "bun.lockb") or exists(dir, "bun.lock"):
        return "bun"
    return "npm"


def _test_command_for(pm: str) -> str:
    return {
        "yarn": "yarn test",
        "pnpm": "pnpm test",
        "bun": "bun test",
    }.get(pm, "npm test")


def _build_command_for(pm: str) -> str:
    return {
        "yarn": "yarn build",
        "pnpm": "pnpm build",
        "bun": "bun run build",
    }.get(pm, "npm run build")


def detect_project(dir: Path) -> dict:
    stacks = []
    test_commands = []
    build_commands = []
    package_manager = None

    if exists(dir, "package.json"):
        stacks.append("node")
        package_manager = detect_package_manager(dir)
        pkg = read_json(dir / "package.json")
        scripts = pkg.get("scripts") if isinstance(pkg.get("scripts"), dict) else {}
        test_script = scripts.get("test")
        build_script = scripts.get("build")
        if isinstance(test_script, str) and test_script.strip():
            test_commands.append(_test_command_for(package_manager))
        if isinstance(build_script, str) and build_script.strip():
            build_commands.append(_build_command_for(package_manager))

    python = (
        exists(dir, "pyproject.toml")
        or exists(dir, "requirements.txt")
        or exists(dir, "pytest.ini")
        or exists(dir, "tox.ini")
        or exists(dir, "setup.py")
    )
    if python:
        stacks.append("python")
        if exists(dir, "noxfile.py"):
            test_commands.append("nox")
        elif exists(dir, "tox.ini"):
            test_commands.append("tox")
        else:
            test_commands.append("python -m pytest")
        if exists(dir, "pyproject.toml"):
            build_commands.append("python -m build")

    if exists(dir, "Cargo.toml"):
        stacks.append("rust")
        test_commands.append("cargo test")
        build_commands.append("cargo build")

    if exists(dir, "go.mod"):
        stacks.append("go")
        test_commands.append("go test ./...")
        build_commands.append("go build ./...")

    if exists(dir, "Gemfile"):
        stacks.append("ruby")
        if exists(dir, "bin/rails"):
            test_commands.append("bin/rails test")
        elif exists(dir, "spec"):
            test_commands.append("bundle exec rspec")
        else:
            test_commands.append("bundle exec rake test")

    if exists(dir, "composer.json"):
        stacks.append("php")
        if exists(dir, "artisan"):
            test_commands.append("php artisan test")
        else:
            test_commands.append("vendor/bin/phpunit")

    if exists(dir, "pom.xml"):
        stacks.append("java")
        test_commands.append("mvn test")
        build_commands.append("mvn package")

    if exists(dir, "gradlew") or exists(dir, "build.gradle"):
        stacks.append("java")
        wrapper = exists(dir, "gradlew")
        test_commands.append("./gradlew test" if wrapper else "gradle test")
        build_commands.append("./gradlew build" if wrapper else "gradle build")

    if exists(dir, "Makefile"):
        try:
            makefile = (dir / "Makefile").read_text(encoding="utf-8")
            if re.search(r"^test\s*:", makefile, flags=re.MULTILINE):
                stacks.append("make")
                test_commands.append("make test")
        except OSError:
            pass  # unreadable Makefile — skip

    return {
        "root": dir,
        "stacks": _dedupe(stacks),
        "package_manager": package_manager,
        "test_commands": _dedupe(test_commands),
        "build_commands": _dedupe(build_commands),
    }


def _read_gitignore(dir: Path) -> tuple:
    ignored = set()
    negated = set()
    try:
        lines = (dir / ".gitignore").read_text(encoding="utf-8").splitlines()
    except OSError:
        return ignored, negated  # no .gitignore — no artifacts are safe
    for line in lines:
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        target = negated if line.startswith("!") else ignored
        normalized = line
        normalized = re.sub(r"^!", "", normalized)
        normalized = re.sub(r"^/+", "", normalized)
        normalized = re.sub(r"/+$", "", normalized)
        normalized = re.sub(r"/\*\*?$", "", normalized)
        if normalized:
            target.add(normalized)
    return ignored, negated


def detect_artifacts(dir: Path) -> list:
    ignored, negated = _read_gitignore(dir)
    artifacts = []
    for name in ARTIFACT_NAMES:
        if name not in ignored:
            continue
        # A negated child means the directory contains tracked files.
        if name in negated or any(e.startswith(name + "/") for e in negated):
            continue
        try:
            if not (dir / name).is_dir():
                continue
        except OSError:
            continue
        artifacts.append(name)
    return artifacts


def detect_protected(dir: Path) -> list:
    from afm import ALWAYS_PROTECTED

    protected = list(ALWAYS_PROTECTED)
    for name in SOURCE_DIRS + MANIFESTS:
        if exists(dir, name):
            protected.append(name)
    return _dedupe(protected)
