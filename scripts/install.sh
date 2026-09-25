#!/usr/bin/env bash
# aftermath bootstrapper — curl-pipe safe.
#
#   curl -fsSL https://raw.githubusercontent.com/moah0911/aftermath/main/scripts/install.sh \
#     | bash -s -- [--project] [--host h] [--ref ref] [--mode m] [--dry-run] [--uninstall]
#
# Checks git + node, clones (or fast-forward-updates) moah0911/aftermath, then
# execs the Node installer forwarding known flags verbatim. Unknown flags fail
# before any network. No interactivity: when piped, stdin is this script, so
# all input comes from flags and every step is idempotent. See scripts/install.js for the full flag list.
set -euo pipefail

REPO_URL="https://github.com/moah0911/aftermath"
REF="main"
SOURCE=""

# Only --ref/--source affect the bootstrapper; the rest pass through.
PASSTHROUGH=()
while [ $# -gt 0 ]; do
  case "$1" in
    --ref)
      [ $# -lt 2 ] && { echo "aftermath: --ref needs a value" >&2; exit 1; }
      REF="$2"; PASSTHROUGH+=("$1" "$2"); shift 2 ;;
    --source)
      [ $# -lt 2 ] && { echo "aftermath: --source needs a value" >&2; exit 1; }
      SOURCE="$2"; shift 2 ;;
    -h|--help)
      cat <<'EOF'
Usage: install.sh [options] [-- installer flags...]

Bootstrapper options (consumed here):
  --ref <ref>      git ref to clone (default: main)
  --source <dir>   use a local checkout instead of cloning
  -h, --help       this text

Everything else is forwarded verbatim to scripts/install.js:
  --project --host opencode|claude|codex|all --mode lite|full|ultra|off
  --dry-run --uninstall

Remote one-liner:
  curl -fsSL https://raw.githubusercontent.com/moah0911/aftermath/main/scripts/install.sh \
    | bash -s -- [--project] [--host h] [--mode m] [--dry-run]
EOF
      exit 0 ;;
    --host|--mode)
      [ $# -lt 2 ] && { echo "aftermath: $1 needs a value" >&2; exit 1; }
      PASSTHROUGH+=("$1" "$2"); shift 2 ;;
    --project|--dry-run|--uninstall)
      PASSTHROUGH+=("$1"); shift ;;
    --*)
      echo "aftermath: unknown flag: $1" >&2; exit 1 ;;
    *)
      echo "aftermath: unexpected argument: $1" >&2; exit 1 ;;
  esac
done

fail() { echo "aftermath: $1" >&2; exit 1; }

command -v git >/dev/null 2>&1 || fail "git is required but not on PATH"
command -v node >/dev/null 2>&1 || fail "node >= 18 is required but not on PATH"
NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
[ "$NODE_MAJOR" -ge 18 ] || fail "node >= 18 required (found $(node --version))"

if [ -n "$SOURCE" ]; then
  REPO_DIR="$(cd "$SOURCE" && pwd)" || fail "cannot resolve --source: $SOURCE"
  [ -f "$REPO_DIR/scripts/install.js" ] || fail "not an aftermath checkout (missing scripts/install.js): $REPO_DIR"
  PASSTHROUGH+=("--source" "$REPO_DIR")
else
  BASE="${XDG_CONFIG_HOME:-$HOME/.config}"
  REPO_DIR="$BASE/aftermath/repo"
  if [ -d "$REPO_DIR/.git" ]; then
    echo "aftermath: updating cached clone: $REPO_DIR"
    git -C "$REPO_DIR" fetch origin >/dev/null 2>&1 || fail "git fetch failed"
    git -C "$REPO_DIR" checkout "$REF" >/dev/null 2>&1 || fail "unknown ref: $REF"
    git -C "$REPO_DIR" pull --ff-only origin "$REF" >/dev/null 2>&1 || fail "git pull --ff-only failed (diverged? remove $REPO_DIR and retry)"
  else
    echo "aftermath: cloning $REPO_URL#$REF"
    mkdir -p "$(dirname "$REPO_DIR")" || fail "cannot create $(dirname "$REPO_DIR")"
    git clone --branch "$REF" --depth 1 "$REPO_URL" "$REPO_DIR" >/dev/null 2>&1 \
      || fail "git clone failed"
  fi
fi

exec node "$REPO_DIR/scripts/install.js" "${PASSTHROUGH[@]}"
