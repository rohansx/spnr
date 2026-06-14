#!/usr/bin/env bash
#
# spnr — one-command LOCAL demo installer.
#
# What this does (idempotent, safe to re-run):
#   1. find the repo root (this script lives in install/, so root is its parent)
#   2. require `cargo` (points you at https://rustup.rs if missing)
#   3. `cargo build --release` the client binaries + the Rust backend
#   4. start the demo backend on :8787 in the background if it isn't already up,
#      and wait for GET /health
#   5. run `spnr install --server <SPNR_SERVER>` — snapshots your pristine
#      ~/.claude/settings.json, APPENDS the spnr hooks (never clobbers existing
#      hooks), and symlinks the binaries into ~/.local/bin
#   6. start the daemon (`SPNR_SERVER=<url> spnrd`) in the background if it isn't
#      already running — it registers a device key, fetches the creative pool,
#      injects the rotating spinner ads + clickable status line
#   7. print next steps
#
# This is a LOCAL demo: the backend runs on your machine, there are NO real
# payouts, and the daemon is a plain background process (no systemd unit yet).
# Reverse everything at any time with `install/uninstall.sh` or `spnr uninstall`.
#
# Env overrides:
#   SPNR_SERVER   ad backend URL the daemon registers with (default http://127.0.0.1:8787)
# Flags:
#   --no-backend  don't build/start the local backend (use an existing SPNR_SERVER)
#   --no-daemon   wire spnr in but don't start the daemon (no spinner injection)
#   -h | --help   show this help

set -euo pipefail

# ---- config -----------------------------------------------------------------
SPNR_SERVER="${SPNR_SERVER:-http://127.0.0.1:8787}"
START_BACKEND=1
START_DAEMON=1
LOG_DIR="${TMPDIR:-/tmp}"
SERVER_LOG="$LOG_DIR/spnr-server.log"
DAEMON_LOG="$LOG_DIR/spnrd.log"

for arg in "$@"; do
  case "$arg" in
    --no-backend) START_BACKEND=0 ;;
    --no-daemon)  START_DAEMON=0 ;;
    -h|--help)
      sed -n '2,40p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "spnr install: unknown argument '$arg' (try --help)" >&2
      exit 2
      ;;
  esac
done

# ---- repo root (this script lives in install/) ------------------------------
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BIN="$ROOT/target/release"

# ---- derive the backend port from SPNR_SERVER (server reads SPNR_SERVER_PORT) -
# Strip scheme + host, keep the port; default 8787 if the URL carries no :port.
PORT="$(printf '%s' "$SPNR_SERVER" | sed -n 's#^[a-zA-Z][a-zA-Z0-9+.-]*://[^/:]*:\([0-9][0-9]*\).*#\1#p')"
PORT="${PORT:-8787}"
HEALTH_URL="http://127.0.0.1:$PORT/health"

# ---- helpers ----------------------------------------------------------------
section(){ printf '\n\033[1;36m== %s ==\033[0m\n' "$*"; }
info(){    printf '  %s\n' "$*"; }
ok(){      printf '  \033[32m✔\033[0m %s\n' "$*"; }
warn(){    printf '  \033[33m!\033[0m %s\n' "$*"; }
die(){     printf '\n\033[31m✘ %s\033[0m\n' "$*" >&2; exit 1; }

# True if a TCP listener for $PORT is already answering /health.
backend_up(){ curl -sf "$HEALTH_URL" >/dev/null 2>&1; }

# True if our daemon is already running. We match the spnrd binary path
# precisely (never a broad pattern that could match this script or an editor).
daemon_pids(){ pgrep -f "$BIN/spnrd" 2>/dev/null || true; }

echo
echo "spnr — local demo installer"
echo "repo root : $ROOT"
echo "backend   : $SPNR_SERVER  (health: $HEALTH_URL)"

# ---- 1. toolchain check -----------------------------------------------------
section "Checking toolchain"
if ! command -v cargo >/dev/null 2>&1; then
  die "cargo not found. Install the Rust toolchain first: https://rustup.rs"
fi
ok "cargo: $(cargo --version)"
command -v curl >/dev/null 2>&1 || die "curl not found — required to health-check the backend."

# ---- 2. build ---------------------------------------------------------------
section "Building release binaries (cargo build --release)"
info "this builds spnr, spnrd, spnr-hook, spnr-status$([ "$START_BACKEND" -eq 1 ] && echo ', spnr-server')"
if [ "$START_BACKEND" -eq 1 ]; then
  cargo build --release \
    --manifest-path "$ROOT/Cargo.toml" \
    -p spnr-cli -p spnrd -p spnr-hook -p spnr-status -p spnr-server
else
  cargo build --release \
    --manifest-path "$ROOT/Cargo.toml" \
    -p spnr-cli -p spnrd -p spnr-hook -p spnr-status
fi
for b in spnr spnrd spnr-hook spnr-status; do
  [ -x "$BIN/$b" ] || die "expected binary missing after build: $BIN/$b"
done
ok "client binaries built → $BIN"

# ---- 3. backend -------------------------------------------------------------
if [ "$START_BACKEND" -eq 1 ]; then
  section "Starting the local demo backend on :$PORT"
  if backend_up; then
    ok "backend already healthy at $HEALTH_URL — leaving it as-is"
  else
    [ -x "$BIN/spnr-server" ] || die "spnr-server missing: $BIN/spnr-server"
    info "launching spnr-server (log → $SERVER_LOG)"
    SPNR_SERVER_PORT="$PORT" nohup "$BIN/spnr-server" >"$SERVER_LOG" 2>&1 &
    # Wait for /health (up to ~10s).
    for _ in $(seq 50); do backend_up && break; sleep 0.2; done
    if backend_up; then
      ok "backend healthy at $HEALTH_URL"
    else
      warn "backend did not become healthy — see $SERVER_LOG"
      die "backend failed to start. Tail: $SERVER_LOG"
    fi
  fi
else
  section "Skipping backend (--no-backend)"
  if backend_up; then
    ok "using existing backend at $HEALTH_URL"
  else
    warn "no backend reachable at $HEALTH_URL — the daemon will fail-stock (no ads)."
  fi
fi

# ---- 4. wire spnr into Claude Code (append-only, reversible) -----------------
section "Wiring spnr into Claude Code"
info "snapshots your settings, APPENDS hooks (existing hooks untouched), links binaries"
"$BIN/spnr" install --server "$SPNR_SERVER"
ok "spnr install complete"

# ---- 5. daemon --------------------------------------------------------------
if [ "$START_DAEMON" -eq 1 ]; then
  section "Starting the spnr daemon"
  EXISTING="$(daemon_pids)"
  if [ -n "$EXISTING" ]; then
    ok "spnrd already running (pid: $(echo "$EXISTING" | tr '\n' ' '))"
  else
    info "launching spnrd (log → $DAEMON_LOG)"
    SPNR_SERVER="$SPNR_SERVER" nohup "$BIN/spnrd" >"$DAEMON_LOG" 2>&1 &
    sleep 0.5
    if [ -n "$(daemon_pids)" ]; then
      ok "spnrd running — registered device, fetched creatives, injected the spinner"
    else
      warn "spnrd did not stay up — see $DAEMON_LOG"
    fi
  fi
else
  section "Skipping daemon (--no-daemon)"
  warn "no spinner injection until you start it: SPNR_SERVER=$SPNR_SERVER $BIN/spnrd &"
fi

# ---- 6. next steps ----------------------------------------------------------
section "Done — next steps"
cat <<EOF
  1. Run a Claude Code turn. While the agent works, the spinner shows the
     sponsored rotating verbs and the status line shows your live earnings.
  2. Check status:        spnr status
  3. See the raw queue:   spnr audit
  4. Reverse everything:  bash install/uninstall.sh   (or: spnr uninstall)

  Logs:
    backend → $SERVER_LOG
    daemon  → $DAEMON_LOG

\033[1;33m  NOTE: This is a LOCAL demo. The backend runs on your machine on :$PORT,
  there are NO real payouts (the ledger is balanced double-entry only), and
  the daemon is a plain background process — there is NO systemd unit yet, so
  it will not survive a reboot.\033[0m
EOF
