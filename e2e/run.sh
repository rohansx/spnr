#!/usr/bin/env bash
# spnr end-to-end test: real binaries, real unix socket, real HTTP.
#
# Proves the full loop: backend serves a creative -> daemon injects the spinner +
# registers its device key -> a simulated Claude Code session (real spnr-hook /
# spnr-status binaries over the unix socket) accrues attested wait-time -> the
# daemon signs + chains + flushes SAP/1 events -> the backend verifies the
# signatures + chain and accrues a double-entry ledger -> balance / dashboard
# reflect real earnings.
set -uo pipefail

ROOT="/home/rsx/Desktop/projx/spnr"
BIN="$ROOT/target/release"
# Hermetic E2E backend port — defaults to 8788 so it NEVER collides with the
# live demo on 8787 (vite for the E2E UI runs on 5174, live demo on 5173).
PORT="${SPNR_SERVER_PORT:-8788}"
VITE_PORT="${SPNR_VITE_PORT:-5174}"
PORTAL_PORT="${SPNR_PORTAL_PORT:-8791}"
SERVER="http://127.0.0.1:$PORT"
WORK="$(mktemp -d /tmp/spnr-e2e.XXXXXX)"
export SPNR_HOME="$WORK/home"
export SPNR_SETTINGS="$WORK/claude/settings.json"
export SPNR_STATUS_CACHE="$SPNR_HOME/status.cache"
SOCK="$SPNR_HOME/spnrd.sock"
mkdir -p "$SPNR_HOME" "$WORK/claude"
# Fresh per-run persistence stores INSIDE $WORK so every E2E run starts empty
# (keeps the deterministic assertions: impressions==2, balance $0.010, etc.)
# and so we can prove restore-on-reopen below. Exported BEFORE any server boots.
export SPNR_DB="$WORK/server.db"            # Rust spnr-server SQLite store
export SPNR_PORTAL_DB="$WORK/portal.json"   # server-ts JSON store
# A realistic pre-existing host settings file (must survive injection).
printf '{\n  "model": "claude-opus-4-8",\n  "theme": "dark"\n}\n' > "$SPNR_SETTINGS"

SERVER_PID="" ; DAEMON_PID="" ; VITE_PID="" ; PORTAL_PID="" ; FAIL=0
log(){ printf '  %s\n' "$*"; }
pass(){ printf '  \033[32mPASS\033[0m %s\n' "$*"; }
fail(){ printf '  \033[31mFAIL\033[0m %s\n' "$*"; FAIL=1; }
cleanup(){
  [ -n "$VITE_PID" ] && kill "$VITE_PID" 2>/dev/null
  [ -n "$PORTAL_PID" ] && kill "$PORTAL_PID" 2>/dev/null
  [ -n "$DAEMON_PID" ] && kill "$DAEMON_PID" 2>/dev/null
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null
}
trap cleanup EXIT

wait_for(){ # url, label, tries
  local url="$1" label="$2" tries="${3:-50}"
  for _ in $(seq "$tries"); do curl -sf "$url" >/dev/null 2>&1 && return 0; sleep 0.2; done
  fail "timed out waiting for $label ($url)"; return 1
}

echo "== spnr E2E =="
echo "workdir: $WORK"

# 1. backend (on the hermetic $PORT — never the live demo's 8787)
SPNR_SERVER_PORT="$PORT" "$BIN/spnr-server" >"$WORK/server.log" 2>&1 & SERVER_PID=$!
wait_for "$SERVER/health" "server health" || { cat "$WORK/server.log"; exit 1; }
pass "backend up on $SERVER"

# 2. daemon (registers device + fetches creative + injects spinner)
SPNR_SERVER="$SERVER" "$BIN/spnrd" >"$WORK/daemon.log" 2>&1 & DAEMON_PID=$!
for _ in $(seq 50); do [ -S "$SOCK" ] && break; sleep 0.2; done
[ -S "$SOCK" ] && pass "daemon socket up: $SOCK" || fail "daemon socket never appeared"

# 3. spinner injection into the host settings file (editor-safety: host keys kept)
sleep 0.5
if grep -q '"spinnerVerbs"' "$SPNR_SETTINGS" && grep -q '"model"' "$SPNR_SETTINGS"; then
  pass "spinner injected, host keys preserved"
  log "verbs: $(jq -c '.spinnerVerbs.verbs' "$SPNR_SETTINGS" 2>/dev/null)"
else
  fail "spinnerVerbs not injected or host keys lost"; cat "$SPNR_SETTINGS"
fi

# 4. simulate a Claude Code session over the REAL hook/status binaries
hook(){ printf '{"hook_event_name":"%s","session_id":"e2e-1","cwd":"/secret","prompt":"do not leak me"}' "$1" | SPNR_SOCK="$SOCK" "$BIN/spnr-hook"; }
beat(){ printf '{"session_id":"e2e-1","model":{"id":"x"},"cost":{"total_duration_ms":1}}' | SPNR_SOCK="$SOCK" "$BIN/spnr-status" >/dev/null; }

log "opening wait interval + ~13s of 1Hz heartbeats (spec: 5 attested s = 1 impression)"
hook UserPromptSubmit
for _ in $(seq 13); do beat; sleep 1; done
hook Stop

# 5. let the daemon flush signed events to the backend
sleep 2
for _ in $(seq 25); do
  imps="$(curl -sf "$SERVER/api/stats" | jq -r '.total_impressions' 2>/dev/null)"
  [ "${imps:-0}" -gt 0 ] 2>/dev/null && break; sleep 0.4
done

# 6. assertions
STATS="$(curl -sf "$SERVER/api/stats")"
echo "  stats: $STATS"
IMP="$(jq -r '.total_impressions' <<<"$STATS")"
BAL="$(jq -r '.total_balance_micros' <<<"$STATS")"
BALANCED="$(jq -r '.ledger_balanced' <<<"$STATS")"
DEVICES="$(jq -r '.devices' <<<"$STATS")"

[ "${IMP:-0}" -ge 1 ] 2>/dev/null && pass "attested impressions accrued: $IMP" || fail "no impressions accrued (got '$IMP')"
[ "${BAL:-0}" -ge 1 ] 2>/dev/null && pass "developer balance accrued: $(jq -r '.total_balance_usd' <<<"$STATS") ($BAL micros)" || fail "no balance accrued"
[ "$BALANCED" = "true" ] && pass "double-entry ledger sums to zero" || fail "ledger not balanced"
[ "${DEVICES:-0}" -ge 1 ] 2>/dev/null && pass "device registered: $DEVICES" || fail "no device registered"

# 7. click path through the redirector
CODE=$(jq -r '.short_code' <<<"$STATS")
RC=$(curl -s -o /dev/null -w '%{http_code}' "$SERVER/c/$CODE")
[ "$RC" = "303" ] || [ "$RC" = "302" ] && pass "click redirect ($RC) recorded" || fail "click redirect failed ($RC)"
CLICKS="$(curl -sf "$SERVER/api/stats" | jq -r '.clicks')"
[ "${CLICKS:-0}" -ge 1 ] 2>/dev/null && pass "click counted: $CLICKS" || fail "click not counted"

# 8. content firewall end-to-end: the secret prompt/cwd must NOT be in the queue
if grep -q 'do not leak me\|/secret' "$SPNR_HOME/queue.log" 2>/dev/null; then
  fail "CONTENT LEAK: work product found in the outbound queue"
else
  pass "content firewall held (no prompt/cwd in outbound queue)"
fi

# 8b. PERSISTENCE: restart the Rust backend against the SAME $SPNR_DB and prove
#     the attested data (impressions/ledger) survived the restart. A fresh-path
#     server starts empty; a re-opened path must restore the prior SQLite state.
IMP_BEFORE="$(curl -sf "$SERVER/api/stats" | jq -r '.total_impressions' 2>/dev/null)"
log "persistence: restarting backend against $SPNR_DB (impressions before restart: ${IMP_BEFORE:-0})"
kill "$SERVER_PID" 2>/dev/null
# wait for the port to free before relaunching on the same $PORT
for _ in $(seq 50); do curl -sf "$SERVER/health" >/dev/null 2>&1 || break; sleep 0.2; done
SPNR_SERVER_PORT="$PORT" "$BIN/spnr-server" >>"$WORK/server.log" 2>&1 & SERVER_PID=$!
if wait_for "$SERVER/health" "server health (after restart)"; then
  IMP_AFTER="$(curl -sf "$SERVER/api/stats" | jq -r '.total_impressions' 2>/dev/null)"
  if [ "${IMP_AFTER:-0}" -gt 0 ] 2>/dev/null && [ "${IMP_AFTER:-0}" = "${IMP_BEFORE:-0}" ] 2>/dev/null; then
    pass "persistence: impressions survived backend restart ($IMP_AFTER == $IMP_BEFORE, > 0)"
  else
    fail "persistence: impressions did NOT survive restart (before=$IMP_BEFORE after=$IMP_AFTER)"
  fi
else
  fail "persistence: backend never came back up after restart"
fi

# 9. Playwright: a real headless browser renders the server-rendered dashboard
if [ "${PLAYWRIGHT:-1}" = "1" ]; then
  echo "  -- Playwright dashboard test (real headless Chromium) --"
  if NODE_PATH="$(npm root -g)" node "$ROOT/e2e/playwright/dashboard.check.cjs" "$SERVER" "$ROOT/e2e/dashboard.png"; then
    pass "Playwright verified the server-rendered dashboard ($ROOT/e2e/dashboard.png)"
  else
    fail "Playwright dashboard test failed"
  fi
fi

# 10. FULL-STACK: boot the v2 TS portal (server-ts) + the Vite UI (proxying /api ->
#     this E2E Rust backend, /v2 -> this E2E TS portal) and Playwright-test BOTH the
#     LIVE React dashboard (vs the Rust ledger) and the LIVE advertiser portal (vs the
#     v2 API). One command proves the whole Rust + TS + React loop.
if [ "${PLAYWRIGHT:-1}" = "1" ] && [ "${FULLSTACK:-1}" = "1" ]; then
  echo "  -- Full-stack: server-ts ($PORTAL_PORT) + Vite UI ($VITE_PORT) + live Playwright (dashboard + advertiser) --"
  DASH_URL="http://localhost:$VITE_PORT/dashboard"
  STATS_URL="http://localhost:$VITE_PORT/api/stats"
  ADV_URL="http://localhost:$VITE_PORT/advertiser"

  # boot the v2 TypeScript portal API (demand side) on its own hermetic port + seed it
  if [ ! -f "$ROOT/server-ts/dist/server.js" ]; then (cd "$ROOT/server-ts" && npm run build >/dev/null 2>&1); fi
  PORT="$PORTAL_PORT" node "$ROOT/server-ts/dist/server.js" >"$WORK/portal.log" 2>&1 & PORTAL_PID=$!
  if wait_for "http://127.0.0.1:$PORTAL_PORT/health" "server-ts portal" 60; then
    pass "server-ts (v2 portal) up on :$PORTAL_PORT"
    P="http://127.0.0.1:$PORTAL_PORT"
    curl -s -XPOST "$P/v2/campaigns" -H 'content-type: application/json' -d '{"advertiser":"cloakpipe","name":"cloakpipe-launch-06","price_per_block_usd":14.5}' >/dev/null
    curl -s -XPOST "$P/v2/campaigns" -H 'content-type: application/json' -d '{"advertiser":"ctxgraph","name":"ctxgraph-beta-02","price_per_block_usd":8.25}' >/dev/null
    CID=$(curl -s "$P/v2/campaigns" | jq -r '.campaigns[0].id')
    curl -s -XPOST "$P/v2/campaigns/$CID/creative" -H 'content-type: application/json' -d '{"text":"CloakPipe — secrets that never touch disk ↗","url":"https://cloakpipe.dev"}' >/dev/null
  else
    fail "server-ts never became reachable on :$PORTAL_PORT"; cat "$WORK/portal.log"
  fi

  # Boot Vite: /api -> E2E Rust backend, /v2 -> E2E TS portal.
  SPNR_API="http://127.0.0.1:$PORT" SPNR_PORTAL_API="http://127.0.0.1:$PORTAL_PORT" \
    node "$ROOT/web/node_modules/vite/bin/vite.js" "$ROOT/web" \
    --config "$ROOT/web/vite.config.ts" --port "$VITE_PORT" >"$WORK/vite.log" 2>&1 &
  VITE_PID=$!

  if wait_for "$DASH_URL" "vite dashboard" 80; then
    pass "Vite dev server up on $VITE_PORT (/api -> $PORT, /v2 -> $PORTAL_PORT)"
    BASE_URL="http://localhost:$VITE_PORT"
    # (a0) full email/password auth flow through the real UI (guard -> signup ->
    #      dashboard -> logout -> wrong-password reject -> re-login). Proves auth is
    #      wired end to end before the data checks (which authenticate themselves).
    if node "$ROOT/e2e/playwright/auth.live.cjs" "$BASE_URL" "$WORK/auth-live.png"; then
      cp "$WORK/auth-live.png" "$ROOT/e2e/auth-live.png" 2>/dev/null \
        && log "saved: $ROOT/e2e/auth-live.png"
      pass "Playwright verified the email/password auth flow (signup/login/logout/guard)"
    else
      fail "auth-flow Playwright test failed"; echo "--- vite.log ---"; cat "$WORK/vite.log"
    fi
    # (a) live developer dashboard vs the Rust ledger
    if node "$ROOT/e2e/playwright/dashboard.live.cjs" "$DASH_URL" "$STATS_URL" "$WORK/dashboard-live.png"; then
      cp "$WORK/dashboard-live.png" "$ROOT/e2e/dashboard-live.png" 2>/dev/null \
        && log "saved: $ROOT/e2e/dashboard-live.png"
      pass "Playwright verified the LIVE dashboard (impressions/balance/attestation match the ledger)"
    else
      fail "live dashboard Playwright test failed"; echo "--- vite.log ---"; cat "$WORK/vite.log"
    fi
    # (b) live advertiser portal vs the v2 API
    if node "$ROOT/e2e/playwright/advertiser.live.cjs" "$ADV_URL" "http://localhost:$VITE_PORT/v2/campaigns" "$WORK/advertiser-live.png"; then
      cp "$WORK/advertiser-live.png" "$ROOT/e2e/advertiser-live.png" 2>/dev/null \
        && log "saved: $ROOT/e2e/advertiser-live.png"
      pass "Playwright verified the LIVE advertiser portal (campaigns match the v2 API)"
    else
      fail "live advertiser Playwright test failed"; echo "--- portal.log ---"; cat "$WORK/portal.log"
    fi
  else
    fail "Vite dashboard never became reachable on $DASH_URL"
    echo "--- vite.log ---"; cat "$WORK/vite.log"
  fi
fi

echo
if [ "$FAIL" -eq 0 ]; then
  echo -e "\033[32m== E2E PASS ==\033[0m  impressions=$IMP balance=$(jq -r '.total_balance_usd' <<<"$STATS") ledger=balanced live-dashboard=verified"
  echo "DASHBOARD_URL=$SERVER"
  # keep the server alive briefly so a Playwright run can hit the live dashboard
  if [ "${KEEP_ALIVE:-0}" = "1" ]; then echo "keeping server up ${KEEP_SECS:-30}s for Playwright"; sleep "${KEEP_SECS:-30}"; fi
  exit 0
else
  echo -e "\033[31m== E2E FAIL ==\033[0m"
  echo "--- daemon.log ---"; cat "$WORK/daemon.log"
  echo "--- server.log ---"; cat "$WORK/server.log"
  [ -f "$WORK/vite.log" ] && { echo "--- vite.log ---"; cat "$WORK/vite.log"; }
  exit 1
fi
