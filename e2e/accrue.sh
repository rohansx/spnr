#!/usr/bin/env bash
# Accrue real attested impressions into an ALREADY-RUNNING spnr-server (does not
# start/stop the backend). Spins up a daemon, simulates a Claude Code session over
# the real hook/status binaries, flushes, then exits — leaving the data in the
# backend's in-memory ledger for the live dashboard.
set -uo pipefail
ROOT="/home/rsx/Desktop/projx/spnr"
BIN="$ROOT/target/release"
SERVER="${SPNR_SERVER:-http://127.0.0.1:8787}"
SECS="${SECS:-32}"
WORK="$(mktemp -d /tmp/spnr-accrue.XXXXXX)"
export SPNR_HOME="$WORK/home" SPNR_SETTINGS="$WORK/settings.json" SPNR_STATUS_CACHE="$WORK/home/status.cache"
SOCK="$SPNR_HOME/spnrd.sock"
mkdir -p "$SPNR_HOME"
printf '{\n  "model": "claude-opus-4-8",\n  "theme": "dark"\n}\n' > "$SPNR_SETTINGS"

SPNR_SERVER="$SERVER" "$BIN/spnrd" >"$WORK/d.log" 2>&1 & DPID=$!
trap 'kill $DPID 2>/dev/null' EXIT
for _ in $(seq 50); do [ -S "$SOCK" ] && break; sleep 0.2; done

hook(){ printf '{"hook_event_name":"%s","session_id":"live-1"}' "$1" | SPNR_SOCK="$SOCK" "$BIN/spnr-hook"; }
beat(){ printf '{"session_id":"live-1"}' | SPNR_SOCK="$SOCK" "$BIN/spnr-status" >/dev/null; }

echo "accruing ~${SECS}s of attested wait into $SERVER ..."
hook UserPromptSubmit
for _ in $(seq "$SECS"); do beat; sleep 1; done
hook Stop
sleep 2
echo "stats now: $(curl -s "$SERVER/api/stats")"
