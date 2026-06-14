#!/usr/bin/env bash
#
# spnr — curl-able one-command installer (connects to the HOSTED backend).
#
#   curl -fsSL https://raw.githubusercontent.com/rohansx/spnr/main/install/get.sh | bash
#
# What it does (idempotent, safe to re-run):
#   1. require git + cargo (+ curl)
#   2. clone/update the repo into ~/.spnr/src
#   3. cargo build --release the CLIENT binaries (spnr, spnrd, spnr-hook, spnr-status)
#      — no local backend; you connect to the hosted one
#   4. run `spnr install --server <SPNR_SERVER>` — snapshots your pristine
#      ~/.claude/settings.json, APPENDS the spnr hooks (never clobbers existing
#      hooks), and symlinks the binaries into ~/.local/bin
#   5. start the daemon (detached) pointed at the hosted backend — it registers a
#      device key, fetches the creative pool, and injects the rotating spinner ads
#      + clickable status line
#
# Reverse everything at any time with `spnr uninstall`.
#
# Env overrides:
#   SPNR_SERVER  hosted ad backend (default http://82.112.226.62:8787)
#   SPNR_SRC     where to clone the source (default ~/.spnr/src)
#   SPNR_REF     git branch/ref to build (default main)
# Flags:
#   --no-daemon  wire spnr in but don't start the daemon (no spinner injection yet)
#   -h|--help    show this help
set -euo pipefail

SPNR_SERVER="${SPNR_SERVER:-http://82.112.226.62:8787}"
SPNR_SRC="${SPNR_SRC:-$HOME/.spnr/src}"
SPNR_REF="${SPNR_REF:-main}"
REPO="${SPNR_REPO:-https://github.com/rohansx/spnr.git}"
LOG_DIR="${TMPDIR:-/tmp}"
DAEMON_LOG="$LOG_DIR/spnrd.log"
START_DAEMON=1

for arg in "$@"; do
  case "$arg" in
    --no-daemon) START_DAEMON=0 ;;
    -h|--help) sed -n '2,33p' "$0" 2>/dev/null | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "spnr get: unknown argument '$arg' (try --help)" >&2; exit 2 ;;
  esac
done

section(){ printf '\n\033[1;36m== %s ==\033[0m\n' "$*"; }
info(){    printf '  %s\n' "$*"; }
ok(){      printf '  \033[32m✔\033[0m %s\n' "$*"; }
warn(){    printf '  \033[33m!\033[0m %s\n' "$*"; }
die(){     printf '\n\033[31m✘ %s\033[0m\n' "$*" >&2; exit 1; }

echo
echo "spnr — one-command installer (hosted backend)"
echo "backend : $SPNR_SERVER"
echo "source  : $SPNR_SRC (ref: $SPNR_REF)"

# ---- 1. toolchain -----------------------------------------------------------
section "Checking toolchain"
command -v git   >/dev/null 2>&1 || die "git not found — install git first."
command -v cargo >/dev/null 2>&1 || die "cargo not found. Install the Rust toolchain: https://rustup.rs"
command -v curl  >/dev/null 2>&1 || die "curl not found."
ok "git $(git --version | awk '{print $3}') · $(cargo --version)"

# ---- 2. fetch source --------------------------------------------------------
section "Fetching source"
if [ -d "$SPNR_SRC/.git" ]; then
  info "updating existing checkout"
  git -C "$SPNR_SRC" fetch -q --depth 1 origin "$SPNR_REF"
  git -C "$SPNR_SRC" checkout -q -B "$SPNR_REF" FETCH_HEAD
else
  mkdir -p "$(dirname "$SPNR_SRC")"
  git clone -q --depth 1 --branch "$SPNR_REF" "$REPO" "$SPNR_SRC"
fi
ok "source at $SPNR_SRC ($(git -C "$SPNR_SRC" rev-parse --short HEAD))"

# ---- 3. build client binaries ----------------------------------------------
section "Building client binaries (cargo build --release)"
info "spnr, spnrd, spnr-hook, spnr-status — this can take a couple of minutes the first time"
cargo build --release --manifest-path "$SPNR_SRC/Cargo.toml" \
  -p spnr-cli -p spnrd -p spnr-hook -p spnr-status
BIN="$SPNR_SRC/target/release"
for b in spnr spnrd spnr-hook spnr-status; do
  [ -x "$BIN/$b" ] || die "expected binary missing after build: $BIN/$b"
done
ok "binaries built → $BIN"

# ---- 4. backend reachability -----------------------------------------------
section "Checking the hosted backend"
if curl -fsS --connect-timeout 8 "$SPNR_SERVER/health" >/dev/null 2>&1; then
  ok "reachable: $SPNR_SERVER"
else
  warn "could not reach $SPNR_SERVER/health — the daemon will fail-stock (no ads) until it is up."
fi

# ---- 5. wire spnr into Claude Code (append-only, reversible) -----------------
section "Wiring spnr into Claude Code"
info "snapshots your settings, APPENDS hooks (existing hooks untouched), links binaries"
"$BIN/spnr" install --server "$SPNR_SERVER"
ok "spnr install complete"

# ---- 6. daemon (detached) ---------------------------------------------------
if [ "$START_DAEMON" -eq 1 ]; then
  section "Starting the spnr daemon"
  if pgrep -f "$BIN/spnrd" >/dev/null 2>&1; then
    ok "spnrd already running (pid: $(pgrep -f "$BIN/spnrd" | tr '\n' ' '))"
  else
    info "launching spnrd (detached; log → $DAEMON_LOG)"
    SPNR_SERVER="$SPNR_SERVER" setsid "$BIN/spnrd" >"$DAEMON_LOG" 2>&1 < /dev/null &
    sleep 1
    if pgrep -f "$BIN/spnrd" >/dev/null 2>&1; then
      ok "spnrd running — registered a device, fetched the creative pool, injected the spinner"
    else
      warn "spnrd did not stay up — see $DAEMON_LOG"
    fi
  fi
else
  section "Skipping daemon (--no-daemon)"
  warn "no spinner injection until you start it: SPNR_SERVER=$SPNR_SERVER $BIN/spnrd &"
fi

# ---- 7. next steps ----------------------------------------------------------
section "Done"
cat <<EOF
  Run a Claude Code turn — the spinner shows rotating sponsored ads and the
  status line is a clickable earnings ticker (Cmd/Ctrl+click it).

    spnr status        # queued events + injected/stock
    spnr audit         # the raw outbound queue (privacy self-check)
    spnr uninstall     # reverse everything; restores your pristine settings

  Tip: link this install to your account in the operator console (shown under
  Connected sessions) by setting SPNR_EMAIL when you install:

    SPNR_EMAIL=you@example.com curl -fsSL https://get.spnr.sh | bash

  Connected to: $SPNR_SERVER
  Daemon log:   $DAEMON_LOG
EOF
