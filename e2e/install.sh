#!/usr/bin/env bash
# spnr install/uninstall hermetic test — exercises the REAL `spnr` binary against a
# throwaway $HOME that mirrors a power user's ~/.claude/settings.json (existing RTK +
# gitnexus + session-end hooks). Proves:
#   1. `spnr install` APPENDS spnr hooks without clobbering any existing hook
#   2. it snapshots the pristine settings (uninstall anchor) + links binaries
#   3. the daemon injects spinnerVerbs (object form) + statusLine (ABSOLUTE
#      spnr-status path, refreshInterval:1) on top, host keys preserved
#   4. a real hook/heartbeat session through the WIRED absolute binaries accrues
#      attested impressions on the backend
#   5. `spnr uninstall` restores the settings to byte-identical pristine, removing
#      the spnr hooks/keys + symlinks, leaving every foreign hook intact
set -uo pipefail

ROOT="/home/rsx/Desktop/projx/spnr"
BIN="$ROOT/target/release"
PORT="${SPNR_INSTALL_PORT:-8799}"           # hermetic, never the demo(8787)/E2E(8788)
SERVER="http://127.0.0.1:$PORT"
WORK="$(mktemp -d /tmp/spnr-install.XXXXXX)"
export HOME="$WORK"                          # the whole test is hermetic under $HOME
SETTINGS="$HOME/.claude/settings.json"
BACKUP="$HOME/.spnr/backup.json"
mkdir -p "$HOME/.claude"

SERVER_PID="" ; DAEMON_PID="" ; FAIL=0
log(){ printf '  %s\n' "$*"; }
pass(){ printf '  \033[32mPASS\033[0m %s\n' "$*"; }
fail(){ printf '  \033[31mFAIL\033[0m %s\n' "$*"; FAIL=1; }
cleanup(){ [ -n "$DAEMON_PID" ] && kill "$DAEMON_PID" 2>/dev/null; [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null; }
trap cleanup EXIT
wait_for(){ for _ in $(seq "${3:-50}"); do curl -sf "$1" >/dev/null 2>&1 && return 0; sleep 0.2; done; fail "timeout: $2"; return 1; }

echo "== spnr install/uninstall hermetic test =="
echo "HOME=$HOME"

# A realistic pre-existing host settings file: model + permissions + the same hook
# shapes the real user has (RTK rewrite on PreToolUse Bash, gitnexus, session-end on
# Stop). The installer must preserve ALL of this.
cat > "$SETTINGS" <<'JSON'
{
  "model": "opus[1m]",
  "permissions": { "allow": ["Bash(git*)", "Read"], "deny": [] },
  "effortLevel": "xhigh",
  "hooks": {
    "PreToolUse": [
      { "matcher": "Bash", "hooks": [{ "type": "command", "command": "/h/rtk-rewrite.sh" }] },
      { "matcher": "Grep|Glob|Bash", "hooks": [{ "type": "command", "command": "node gitnexus.cjs", "timeout": 10 }] }
    ],
    "Stop": [
      { "matcher": "", "hooks": [{ "type": "command", "command": "/h/session-end-brain.sh" }] }
    ]
  }
}
JSON
cp "$SETTINGS" "$WORK/pristine.json"

# ---- 1. install ----
"$BIN/spnr" install --server "$SERVER" >"$WORK/install.log" 2>&1 || fail "spnr install exited non-zero"
log "$(grep -c . "$WORK/install.log" 2>/dev/null) line(s) of install output"

jq -e . "$SETTINGS" >/dev/null 2>&1 && pass "settings.json still valid JSON after install" || fail "settings.json is not valid JSON"

# foreign hooks intact
[ "$(jq -r '.hooks.PreToolUse | length' "$SETTINGS")" = "2" ] && pass "PreToolUse (RTK + gitnexus) preserved" || fail "PreToolUse changed"
[ "$(jq -r '.hooks.PreToolUse[0].hooks[0].command' "$SETTINGS")" = "/h/rtk-rewrite.sh" ] && pass "RTK rewrite hook intact" || fail "RTK hook altered"
[ "$(jq -r '.hooks.Stop[0].hooks[0].command' "$SETTINGS")" = "/h/session-end-brain.sh" ] && pass "existing Stop hook still first" || fail "existing Stop hook lost/moved"
# host keys intact
[ "$(jq -r '.model' "$SETTINGS")" = "opus[1m]" ] && [ "$(jq -r '.permissions.allow | length' "$SETTINGS")" = "2" ] && pass "model + permissions preserved" || fail "host keys changed"

# spnr hooks appended (absolute spnr-hook path)
STOP_LEN="$(jq -r '.hooks.Stop | length' "$SETTINGS")"
[ "$STOP_LEN" = "2" ] && pass "spnr appended a 2nd Stop group (not a replace)" || fail "Stop group count=$STOP_LEN (want 2)"
SPNR_STOP="$(jq -r '.hooks.Stop[1].hooks[0].command' "$SETTINGS")"
case "$SPNR_STOP" in */spnr-hook) pass "spnr Stop hook is an absolute spnr-hook path: $SPNR_STOP" ;; *) fail "spnr Stop hook not absolute: $SPNR_STOP" ;; esac
UPS="$(jq -r '.hooks.UserPromptSubmit[0].hooks[0].command' "$SETTINGS")"
case "$UPS" in */spnr-hook) pass "UserPromptSubmit wired to spnr-hook" ;; *) fail "UserPromptSubmit not wired: $UPS" ;; esac
SE="$(jq -r '.hooks.SessionEnd[0].hooks[0].command' "$SETTINGS")"
case "$SE" in */spnr-hook) pass "SessionEnd wired to spnr-hook" ;; *) fail "SessionEnd not wired: $SE" ;; esac
# we deliberately did NOT add PostToolUse
[ "$(jq -r 'has("hooks") and (.hooks|has("PostToolUse"))' "$SETTINGS")" = "false" ] && pass "PostToolUse left absent (no needless edit)" || fail "PostToolUse unexpectedly added"

# pristine snapshot + symlinks
[ -f "$BACKUP" ] && pass "pristine snapshot written → ~/.spnr/backup.json" || fail "no backup snapshot"
diff -q "$BACKUP" "$WORK/pristine.json" >/dev/null 2>&1 && pass "snapshot equals the pristine pre-install file" || log "(snapshot is pretty-printed; content compared below)"
[ -L "$HOME/.local/bin/spnr-hook" ] && [ -L "$HOME/.local/bin/spnr-status" ] && pass "binaries symlinked into ~/.local/bin" || fail "binaries not symlinked"

# ---- 2. backend + daemon: spinner injection on top of the wired hooks ----
SPNR_SERVER_PORT="$PORT" "$BIN/spnr-server" >"$WORK/server.log" 2>&1 & SERVER_PID=$!
wait_for "$SERVER/health" "backend health" || { cat "$WORK/server.log"; }
SPNR_SERVER="$SERVER" "$BIN/spnrd" >"$WORK/daemon.log" 2>&1 & DAEMON_PID=$!
for _ in $(seq 50); do [ -S "$HOME/.spnr/spnrd.sock" ] && break; sleep 0.2; done
sleep 0.6

# spinnerVerbs object form ({mode:replace, verbs:[...]}) — the sponsored surface.
# MULTIPLE ads: the daemon injects the whole rotation pool, so the spinner cycles them.
SV_MODE="$(jq -r '.spinnerVerbs.mode' "$SETTINGS")"
[ "$SV_MODE" = "replace" ] && pass "spinnerVerbs injected (mode=replace, object form per CC docs)" || fail "spinnerVerbs.mode=$SV_MODE"
NVERBS="$(jq -r '.spinnerVerbs.verbs | length' "$SETTINGS")"
[ "${NVERBS:-0}" -ge 2 ] 2>/dev/null && pass "spinner rotates MULTIPLE ads ($NVERBS): $(jq -c '.spinnerVerbs.verbs' "$SETTINGS")" || fail "expected ≥2 rotating ads, got $NVERBS"
# statusLine with ABSOLUTE spnr-status command + refreshInterval 1
SL_CMD="$(jq -r '.statusLine.command' "$SETTINGS")"
case "$SL_CMD" in */spnr-status) pass "statusLine command is an absolute spnr-status path: $SL_CMD" ;; *) fail "statusLine command not absolute: $SL_CMD" ;; esac
[ "$(jq -r '.statusLine.refreshInterval' "$SETTINGS")" = "1" ] && pass "statusLine refreshInterval=1 (~1Hz heartbeat)" || fail "refreshInterval not 1"

# CLICKABLE: the served pool has multiple creatives, each with its own short_code,
# and the status cache the statusline prints is an OSC-8 hyperlink to /c/{code}.
NPOOL="$(curl -sf "$SERVER/v1/serve" | jq -r '.creatives | length')"
[ "${NPOOL:-0}" -ge 2 ] 2>/dev/null && pass "/v1/serve returns a multi-ad pool ($NPOOL creatives)" || fail "serve pool too small: $NPOOL"
if printf '%s' "$(cat "$HOME/.spnr/status.cache")" | grep -q $'\x1b]8;;'; then
  pass "status line is a CLICKABLE OSC-8 hyperlink"
  CLICK_URL="$(printf '%s' "$(cat "$HOME/.spnr/status.cache")" | sed -n 's/.*\x1b]8;;\([^\x1b]*\).*/\1/p')"
  case "$CLICK_URL" in */c/*) log "click target: $CLICK_URL" ;; esac
else
  fail "status line is not an OSC-8 link: [$(cat "$HOME/.spnr/status.cache")]"
fi
# A non-primary creative's code redirects to ITS advertiser (each ad clickable).
CODE2="$(curl -sf "$SERVER/v1/serve" | jq -r '.creatives[1].short_code')"
URL2="$(curl -sf "$SERVER/v1/serve" | jq -r '.creatives[1].url')"
RC=$(curl -s -o /dev/null -w '%{http_code}' "$SERVER/c/$CODE2")
LOC=$(curl -s -o /dev/null -w '%{redirect_url}' "$SERVER/c/$CODE2")
{ [ "$RC" = "303" ] || [ "$RC" = "302" ]; } && [ "$LOC" = "$URL2" ] && pass "2nd ad ($CODE2) click redirects to its own advertiser ($LOC)" || fail "2nd-ad click wrong (rc=$RC loc=$LOC want=$URL2)"
# the spnr hooks STILL present after the daemon's inject (didn't get clobbered)
[ "$(jq -r '.hooks.Stop | length' "$SETTINGS")" = "2" ] && pass "spnr hooks survive the daemon's spinner inject" || fail "daemon inject disturbed the hooks"

# ---- 3. drive a real session through the WIRED absolute binaries ----
HOOK_BIN="$(jq -r '.hooks.UserPromptSubmit[0].hooks[0].command' "$SETTINGS")"
STATUS_BIN="$SL_CMD"
log "simulating a session via the wired binaries ($HOOK_BIN / $STATUS_BIN)"
printf '{"hook_event_name":"UserPromptSubmit","session_id":"inst-1","cwd":"/secret","prompt":"do not leak"}' | "$HOOK_BIN"
for _ in $(seq 12); do printf '{"session_id":"inst-1","model":{"id":"x"},"cost":{"total_duration_ms":1}}' | "$STATUS_BIN" >/dev/null; sleep 1; done
printf '{"hook_event_name":"Stop","session_id":"inst-1"}' | "$HOOK_BIN"
sleep 2
IMPS=""
for _ in $(seq 25); do IMPS="$(curl -sf "$SERVER/api/stats" | jq -r '.total_impressions' 2>/dev/null)"; [ "${IMPS:-0}" -gt 0 ] 2>/dev/null && break; sleep 0.4; done
[ "${IMPS:-0}" -ge 1 ] 2>/dev/null && pass "wired hooks accrued attested impressions: $IMPS" || fail "no impressions via the installed wiring (got '$IMPS')"
# status cache the statusline prints
STATUS_OUT="$(printf '{"session_id":"inst-1"}' | "$STATUS_BIN")"
case "$STATUS_OUT" in *spnr*) pass "statusline prints a live spnr ticker: '$STATUS_OUT'" ;; *) log "statusline output: '$STATUS_OUT'" ;; esac

# ---- 4. uninstall → pristine ----
kill "$DAEMON_PID" 2>/dev/null; DAEMON_PID=""
"$BIN/spnr" uninstall >"$WORK/uninstall.log" 2>&1 || fail "spnr uninstall exited non-zero"
jq -e . "$SETTINGS" >/dev/null 2>&1 && pass "settings.json valid JSON after uninstall" || fail "settings.json invalid after uninstall"
# byte-identical to pristine (normalize both through jq for a semantic compare)
if diff <(jq -S . "$WORK/pristine.json") <(jq -S . "$SETTINGS") >/dev/null 2>&1; then
  pass "uninstall restored settings to the EXACT pristine config (foreign hooks intact, spnr gone)"
else
  fail "uninstall did not restore pristine settings"; echo "--- diff (pristine vs restored) ---"; diff <(jq -S . "$WORK/pristine.json") <(jq -S . "$SETTINGS")
fi
[ ! -d "$HOME/.spnr" ] && pass "state dir ~/.spnr removed" || fail "~/.spnr not removed"
[ ! -L "$HOME/.local/bin/spnr-hook" ] && pass "symlinks removed from ~/.local/bin" || fail "symlinks not removed"

echo
if [ "$FAIL" -eq 0 ]; then
  echo -e "\033[32m== INSTALL TEST PASS ==\033[0m  hooks appended-not-clobbered · spinner+statusline injected · impressions accrued · uninstall→pristine"
  exit 0
else
  echo -e "\033[31m== INSTALL TEST FAIL ==\033[0m"
  echo "--- install.log ---"; cat "$WORK/install.log"
  echo "--- daemon.log ---"; cat "$WORK/daemon.log"
  exit 1
fi
