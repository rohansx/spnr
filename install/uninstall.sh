#!/usr/bin/env bash
#
# spnr — reverse the local demo install.
#
# What this does (idempotent, safe to re-run):
#   1. stop the spnr daemon (matched precisely by its binary path — NOT a broad
#      pkill that could match this script or your editor)
#   2. stop the local demo backend listening on :8787 (only the spnr-server we
#      started, matched by binary path)
#   3. run `spnr uninstall` — restores your pristine ~/.claude/settings.json from
#      the snapshot, strips the spnr hooks/keys, removes the ~/.local/bin symlinks
#      and the ~/.spnr state dir
#
# This NEVER touches foreign hooks or any host config beyond what spnr added.
#
# Env overrides:
#   SPNR_SERVER   used only to derive the backend port to stop (default http://127.0.0.1:8787)

set -euo pipefail

SPNR_SERVER="${SPNR_SERVER:-http://127.0.0.1:8787}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BIN="$ROOT/target/release"

PORT="$(printf '%s' "$SPNR_SERVER" | sed -n 's#^[a-zA-Z][a-zA-Z0-9+.-]*://[^/:]*:\([0-9][0-9]*\).*#\1#p')"
PORT="${PORT:-8787}"

section(){ printf '\n\033[1;36m== %s ==\033[0m\n' "$*"; }
ok(){      printf '  \033[32m✔\033[0m %s\n' "$*"; }
warn(){    printf '  \033[33m!\033[0m %s\n' "$*"; }

# Stop a process matched ONLY by an exact binary path (never a broad pattern).
# $1 = absolute binary path, $2 = human label.
stop_by_path(){
  local path="$1" label="$2" pids
  pids="$(pgrep -f "$path" 2>/dev/null || true)"
  if [ -z "$pids" ]; then
    warn "$label not running"
    return 0
  fi
  # shellcheck disable=SC2086
  kill $pids 2>/dev/null || true
  # Give it a moment, then force if still alive.
  sleep 0.5
  pids="$(pgrep -f "$path" 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    # shellcheck disable=SC2086
    kill -9 $pids 2>/dev/null || true
  fi
  ok "$label stopped"
}

echo
echo "spnr — local demo uninstaller"
echo "repo root : $ROOT"

# ---- 1. daemon --------------------------------------------------------------
section "Stopping the spnr daemon"
stop_by_path "$BIN/spnrd" "spnrd"

# ---- 2. backend -------------------------------------------------------------
section "Stopping the local demo backend (:$PORT)"
stop_by_path "$BIN/spnr-server" "spnr-server"

# ---- 3. unwire from Claude Code ---------------------------------------------
section "Restoring Claude Code settings"
if [ -x "$BIN/spnr" ]; then
  "$BIN/spnr" uninstall
  ok "spnr uninstall complete — settings restored from snapshot, state removed"
else
  warn "spnr binary not found at $BIN/spnr — build it first (cargo build --release) to fully unwire."
  warn "If hooks remain, run: <path-to>/spnr uninstall"
fi

section "Done"
echo "  spnr removed. Re-install any time with: bash install/install.sh"
