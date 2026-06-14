# spnr — Technical Specification v1.0

> Engineering-grade spec. Companion to `product-spec-v0.2.md` (product/strategy).
> Domains locked: **spnr.sh** (identity + installer) · **spnr.dev** (docs/protocol) · **spnr.co** (advertiser portal).
> June 12, 2026

> **NOTE (preserved source):** Original engineering spec, reproduced verbatim. Validated corrections live in `../13-research-findings.md` and the refined docs. Where this and the refined docs disagree, the refined docs win.

---

## 0. Design invariants

Every decision below derives from six invariants. When in doubt, resolve in this order:

1. **Never degrade the editor/CLI.** spnr failing must be invisible to Claude Code. Hook handlers and the statusline binary have hard latency budgets; the daemon crashing restores stock config.
2. **Never read work product.** Code, prompts, completions, file paths, repo names, transcript content are structurally unreadable by spnr's parsers (enforced in CI, §10.2).
3. **Undercount, never overcount.** Every ambiguity in impression measurement resolves against spnr's revenue. Advertiser trust is the asset; inflated counts destroy it once.
4. **The user's machine is honest until proven otherwise; the network assumes every client is hostile.** All economic truth is established server-side from signed, chained, idempotent events plus server-attributed clicks.
5. **Everything that runs on a user's machine is open source and reproducible.** Published hashes; the install script is short and readable.
6. **Fail quiet, fail stock.** No network → cached creative until TTL → stock verbs. Never a stale ad, never an error in the user's terminal.

---

## 1. System overview

```
 developer machine                                   spnr backend (spnr.co / api.spnr.sh)
┌───────────────────────────────────────┐           ┌─────────────────────────────────────┐
│ Claude Code / Codex CLI               │           │ edge: CDN (creatives, killswitch)   │
│   ├─ hooks ──────────► spnr-hook ─┐   │  HTTPS    │ api-gw (axum)                       │
│   └─ statusLine ─────► spnr-status│   │  batched  │  ├─ ingest (verify, dedup, chain)   │
│                                   ▼   │  signed   │  ├─ auction (serving decisions)     │
│ ~/.claude/settings.json ◄── spnrd ────┼──────────►│  ├─ ledger (double-entry, Postgres) │
│ ~/.spnr/{state,queue,backup}      │   │  events   │  ├─ fraud (ClickHouse features)     │
│ OS keychain (token, device key) ──┘   │           │  ├─ settle (x402/USDC, credits)     │
└───────────────────────────────────────┘           │  └─ portal (advertisers, bids)      │
                                                    └─────────────────────────────────────┘
 click path: terminal OSC-8 link → https://spnr.sh/c/{code} → 302 redirect (click recorded server-side)
```

Three client binaries from one Rust workspace:

| Binary | Role | Latency budget |
|---|---|---|
| `spnrd` | long-running user daemon: ad cache, rotation, settings merge, impression state machine, event signing/queueing, self-update | n/a (background) |
| `spnr-hook` | invoked by Claude Code hooks; forwards event to daemon over unix socket, fire-and-forget | **exit ≤ 50 ms hard** (10 ms typical) |
| `spnr-status` | invoked by Claude Code `statusLine` per render; prints pre-rendered line from tmpfs, pings daemon | **exit ≤ 10 ms hard** |
| `spnr` | user CLI (login/status/redeem/pause/audit/uninstall); thin client of the daemon socket | interactive |

The hot-path binaries (`spnr-hook`, `spnr-status`) do **no** network I/O, no JSON parsing beyond stdin skim, no allocation-heavy work. They write a fixed-size datagram to `~/.spnr/spnrd.sock` (SOCK_DGRAM, non-blocking, 5 ms timeout) and exit. If the daemon is down, they exit 0 silently (invariant 1, 6).

---

## 2. Surfaces & host integration

### 2.1 Spinner surface (`spinnerVerbs`)

- Claude Code reads `spinnerVerbs` from `~/.claude/settings.json` (global) at process start; project-level `.claude/settings.json` can override. v1 touches **global only** and detects project-level overrides (if present, the device serves no spinner impressions — don't fight the user's config).
- **Creative attribution window = session.** Because the host reads verbs at startup, mid-session rotation is impossible. Therefore: `spnrd` rotates the active creative **on SessionStart**, records `(session_id → creative_id)`, and attributes all of that session's impressions to it. Honest, simple, matches reality.
- Sponsored verb format (hard rules, enforced client and server side):
  - ≤ 48 chars, single line, UTF-8 letters/digits/space and `—.,:'&+/↗` only (allow-list regex `^[\p{L}\p{N} —.,:'&+/↗-]{1,48}$`)
  - exactly one trailing ` ↗`
  - **no ANSI/escape bytes ever** — client strips then rejects on mismatch (terminal-injection safety)
  - brand name must appear (server lint)
- While paused/uninstalled/crashed: stock verbs restored from snapshot (§2.3).

### 2.2 Statusline surface (clicks + render heartbeat)

- spnr registers `statusLine.command = "spnr-status"`. The host invokes it on UI render; `spnr-status` prints one cached line from `~/.spnr/statusline.cache` (tmpfs-backed where available) containing:
  - earnings ticker: `spnr ▲ $4.43 today`
  - the active creative's clickable link as an **OSC 8 hyperlink** to `https://spnr.sh/c/{short_code}?d={device_pub_short}` (terminals without OSC 8 see plain text — acceptable degradation)
- **Render heartbeat (key viewability primitive):** the host executes the statusline command *only when an interactive TUI actually paints*. Each invocation therefore proves "a human-visible terminal rendered now." `spnr-status` pings the daemon on each invocation (coalesced to ≤1 ping/sec). Headless `claude -p` runs never invoke statusline → never produce render heartbeats → earn nothing. This is the cheapest strong anti-fraud signal in the system.
- If the user already has a custom statusLine: spnr **does not clobber it**. It offers (a) a wrapper mode that appends spnr's segment to the user's command output, or (b) spinner-only mode (reduced earnings, no click surface). Explicit choice at install.

### 2.3 Settings mutation protocol

State machine for `~/.claude/settings.json`:

```
IDLE ──install──► SNAPSHOT (copy user's spinnerVerbs+statusLine → ~/.spnr/backup.json, fsync)
SNAPSHOT ──► INJECTED (atomic write: parse → modify keys → write tmp → fsync → rename)
INJECTED ──external edit detected──► RE-MERGE (debounced 2s; re-read, re-apply iff our keys absent)
INJECTED ──user removed our keys twice in 24h──► PAUSED (respect the signal; notify via `spnr status`)
INJECTED ──pause/uninstall/killswitch/daemon-stale──► RESTORED (write snapshot back, atomic)
```

- All writes: read full file → `serde_json::Value` round-trip preserving unknown keys → write temp file in same dir → fsync → `rename(2)`. Never partial writes.
- Staleness guard: `spnrd` holds `~/.spnr/lock` with heartbeat mtime. `spnr-hook`/`spnr-status`, on socket failure + lock mtime > 60 s, perform the RESTORE themselves (any spnr binary can restore; restore is idempotent). **The config is never left sponsored without a live daemon.**
- Concurrent writers (Claude Code itself rewrites settings): inotify/FSEvents watcher, 2 s debounce, re-merge only if spnr keys were lost; never overwrite other keys' new values (three-way merge on spnr-owned keys only).

### 2.4 Adapter abstraction

`trait HostAdapter { fn inject(&self); fn restore(&self); fn event_source(&self) -> EventSource; }` with implementations: `claude_code_cli` (v0.1), `codex_cli` (v0.2), `claude_code_ide`/`vscode` (thin wrapper, v0.3). Platform risk lives behind this trait: if `spinnerVerbs` is deprecated, the spinner adapter dies and statusline-only mode continues.

---

## 3. Impression engine

### 3.1 Definitions

- **Wait interval:** continuous span where the host is awaiting model output in an interactive session (spinner visibly animating).
- **Impression:** 5 contiguous seconds of a wait interval that is (a) inside an attested-interactive session and (b) covered by render heartbeats. Partial trailing seconds are dropped (invariant 3).

### 3.2 Signal sources

| Signal | From | Gives |
|---|---|---|
| `SessionStart` / `SessionEnd` | hook | session lifecycle, session_id, creative rotation point |
| `UserPromptSubmit` | hook | wait-interval **open** |
| `PreToolUse` / `PostToolUse` | hook | wait-interval pause/resume boundaries (tool execution ≠ spinner time when tool output streams; conservatively: tool-running time **excluded**) |
| `Stop` | hook | wait-interval **close** |
| render heartbeat | statusline ping | proof an interactive TUI painted within the last second |
| TTY check | hook env / controlling terminal of session pid | interactive vs headless |

Hook payloads arrive on `spnr-hook` stdin as host-provided JSON. The forwarder extracts **only** `{hook_event_name, session_id, timestamp}` via a restricted extractor (§10.2) and datagrams them to the daemon. Everything else on stdin is never deserialized.

### 3.3 Per-session state machine (in `spnrd`)

```
            UserPromptSubmit                Stop
  IDLE ───────────────────────► WAITING ─────────► IDLE
                                  │  ▲
                        PreToolUse│  │PostToolUse
                                  ▼  │
                              TOOL_RUNNING        (TOOL_RUNNING time never counts)
```

Accrual rule per 1-second tick while `WAITING`:
`countable_second := (render_heartbeat within last 2 s) && session.tty_attested && !paused`
Impressions emitted per session per close of each wait interval: `floor(countable_seconds / 5)`, subject to caps:

- ≤ 60 impressions per wait interval (5 min of continuous wait — beyond that something is wrong)
- ≤ 600/hour/device, ≤ 4,000/day/device (tunable server-side; client enforces a superset cap)
- one device = one concurrent counting session (parallel sessions are tracked, but countable seconds are globally single-threaded per device — a human watches one terminal at a time; invariant 3)

### 3.4 Why this resists the obvious attacks

- Headless farms (`claude -p` loops): no statusline render → no heartbeats → zero countable seconds.
- Detached tmux panes running overnight: heartbeats stop when nothing repaints; long idle WAITING without repaint accrues nothing.
- Fake heartbeats (calling `spnr-status` in a loop): heartbeats only *gate* seconds inside hook-derived WAITING intervals; without genuine host hook events there is nothing to gate. Forging both consistently produces a timing distribution the fraud model targets (§7).
- Replay: events are hash-chained per device with a persisted monotonic counter (§4); replays and gaps are server-detectable.

---

## 4. Event & attestation protocol (SAP/1 — "Spinner Ad Protocol", published at spnr.dev)

### 4.1 Device identity

- Ed25519 keypair generated at install; private key sealed in OS keychain (Secret Service / macOS Keychain). `device_id = base32(pubkey[..10])`.
- Login (`spnr login`, GitHub device flow or email magic link) binds `device_id → account_id` server-side. Pseudonymous device, linked account for crediting.

### 4.2 Canonical event

```json
{
  "v": 1,
  "id": "01J...ULID",            // idempotency key
  "ctr": 48211,                   // per-device monotonic counter, persisted, never reused
  "prev": "b3:9af3…",            // BLAKE3 of previous event's canonical bytes (per-device hash chain)
  "t": 1781234567,                // unix seconds
  "type": "imp|click_hint|session_start|session_end|heartbeat_summary",
  "session": "s:7c1f…",          // salted-hash session fingerprint (salt is device-local; raw session_id never leaves machine)
  "creative": "cr_9k2",
  "n": 12                         // for imp: impressions in this batch-second window
}
```

- Encoding: canonical JSON (sorted keys, no whitespace). Signature: Ed25519 over canonical bytes. Events shipped in batches ≤ 500, gzip, `POST /v1/ingest`, signed batch envelope.
- Server verification: signature → counter monotonicity → chain continuity (`prev` matches stored head) → ULID dedup → caps → accept into `events_raw`. Gaps/forks flag the device (not auto-ban; §7).
- Client persistence: append-only queue file `~/.spnr/queue.log` (length-prefixed records, fsync'd per batch), bounded at 10 MB (oldest-drop with a `gap` marker event — honest about loss). Flush: every 60 s, on size threshold, and on `SessionEnd`.

### 4.3 Clicks are server-attributed

Terminal clicks open `https://spnr.sh/c/{short_code}?d={device_pub_short}` → edge records `(creative, device, ts, ip_class, ua)` → 302 to advertiser URL (with optional advertiser click-id). **Clients never self-report billable clicks** (`click_hint` exists only for UX). This single decision removes the most lucrative client-side fraud lever entirely. Click fraud now requires real HTTP from plausible origins — a known, solvable adtech problem (rate limits per device/ip-class, dedup window 10 s, bot UA filtering).

---

## 5. Creative delivery

- `GET https://cdn.spnr.sh/v1/serve?device=…&adapter=claude-code-cli` → `{creative: {id, text, short_code, url_domain, ttl_s, weight}, sig, killswitch: false}` — ETag'd, CDN-cached 60 s, poll jittered 45–75 s.
- Response signed (Ed25519, key pinned in the binary, with one backup key for rotation); invalid signature ⇒ treat as network failure (cached → stock). A compromised CDN cannot serve arbitrary text (invariant: server compromise must not become terminal injection).
- TTL expiry without refresh ⇒ restore stock verbs (fail-stock). Killswitch true ⇒ immediate restore network-wide ≤ 60 s.
- Daemon stores last 3 creatives for offline rotation **only within their TTLs**.

---

## 6. Auction & serving

### 6.1 Mechanics (v1 — deliberately simple and fully published)

- Inventory unit: **block** = 1,000 impressions. Clicks billed at 50× the per-impression price of the winning block (industry-anchored to incumbent; revisit with data).
- Single global slot per adapter. Open ascending queue: campaign bids `price_per_block ≥ $1`; serving order = price desc, FIFO within price. The head campaign serves until its purchased blocks exhaust or it's outbid (outbid ⇒ preempt at next serving decision; partial blocks are honored).
- Anti-sniping: none needed — continuous market, not timed auction. Anti-self-dealing: an account cannot win impressions served to its own devices (server joins advertiser_account × device_account; matches are unpaid and unbilled).
- Frequency: one creative per session (forced by host behavior, §2.1) is the natural cap; additionally ≤ 3 distinct sessions/day/device for the same creative before rotation to queue position 2 (advertiser-favorable variety, published rule).

### 6.2 Targeting (v0.3)

Separately auctioned segments as distinct slots: `adapter` (claude-code/codex), `geo` (country, from edge IP at serve time — never stored on device), `os`. No content/code-based targeting, ever (invariant 2 + product non-goal).

### 6.3 Agent-buyer API (v1.0)

`POST /v1/bids` returns `402 Payment Required` with x402 challenge; agent pays USDC (Base), bid enters the same queue. Buying access requires an agent identity with reputation ≥ threshold (MoltNet attestation) + human-readable creative passing the same lint + a human-review queue for first-time buyers. Agents buying human attention is the novel surface; the gate keeps slop out.

---

## 7. Fraud scoring (server)

Features per device (ClickHouse, 5-min materialization): impressions/hr distribution vs cohort; wait-interval length distribution (human agent turns are heavy-tailed log-normal; farms are uniform/periodic — KS-test distance); heartbeat-to-hook coherence; TTY attestation rate; chain gaps/forks; click CTR outliers; device↔account graph (shared accounts across many devices, payout-address reuse); IP-class entropy of click redirects.

Score ∈ [0,1] → three bands:

- **green:** full accrual, 7-day rolling payout hold (all accounts)
- **amber:** impressions accrue at published discount factor, redemption gated on manual review; device sees nothing different (no fraud-oracle feedback)
- **red:** shadow mode — events accepted, nothing accrues; ban only on manual confirmation

Advertisers see per-campaign attestation coverage + fraud-filter rate (the sellable transparency). Methodology doc published; thresholds private.

---

## 8. Money: ledger, settlement, redemption

### 8.1 Ledger (Postgres, double-entry, append-only)

```
accounts(id, kind: dev|advertiser|house, email, created_at)
devices(id, account_id, pubkey, chain_head, ctr_head, fraud_band, created_at)
campaigns(id, advertiser_id, creative_id, price_per_block_usd, blocks_bought, blocks_served, state)
creatives(id, campaign_id, text, url, short_code, lint_version, approved_by)
ledger_entries(id, ts, debit_acct, credit_acct, amount_usd_micros, kind: imp_earn|click_earn|ad_spend|hold|release|redeem|fraud_clawback, ref)
redemptions(id, account_id, amount, rail: credits|gift|usdc, dest, state: pending|fulfilled|failed, idempotency_key)
events_raw → ClickHouse (immutable)
```

Every accepted impression: `ad_spend` (advertiser escrow → house) + `imp_earn` (house → dev, 50%) + `hold` marker releasing T+7d. Invariant check (CI + nightly job): ledger sums to zero; no `release` without matching `hold`.

### 8.2 Settlement rail (x402 / USDC on Base)

- Advertiser funding: card (Stripe, where available) **or** x402: `POST /v1/fund` → 402 challenge → USDC transfer to escrow address → credit on confirmation (2 blocks). All internal accounting in USD micros; USDC treated 1:1 with a depeg circuit-breaker (pause funding/payouts if oracle deviation > 50 bps).
- Developer payout tiers:
  - **credits (default):** redeem ≥ $5 into Anthropic/OpenAI API credit codes or gift cards via fulfillment API; idempotent; delivered in-CLI (`spnr redeem`) and by email. No KYC below regulatory thresholds; velocity limits.
  - **USDC (opt-in):** user supplies address (checksummed, test-tx confirm flow); hourly batch sweep from hot wallet (balance-capped, cold-replenished); per-payout and daily caps; India VDA/TDS notice surfaced in-flow.
- Treasury: advertiser escrow segregated from operating funds; on-chain escrow address published for auditability.

### 8.3 Why clicks/impressions can't double-pay

Idempotency at three layers: event ULID unique index (ingest), `(device, ctr)` unique (chain), `ledger.ref` unique per economic event. Redemption uses client-supplied idempotency keys.

---

## 9. Backend architecture

- **Services (Rust/axum, boring on purpose):** `api-gw`, `ingest`, `auction`, `ledger`, `settle`, `portal-api`, `redirector` (the `/c/{code}` edge, latency-critical). Postgres 16 (ledger/control plane), Redis (auction head, creative cache, rate limits), ClickHouse (events/fraud), object storage (audit exports, build artifacts).
- **Scale math (sanity):** 100k devices × 4k impressions/day max = 4×10⁸ imp-events/day ≈ 4.6k/s peak — trivial for ClickHouse; ledger writes are aggregated per device-hour (impressions batch into hourly `imp_earn` entries), keeping Postgres at ~tens of writes/s per 100k devices.
- **Killswitch:** signed flag at CDN edge + `/v1/serve`; flips creative payload to `null`. Tested weekly in staging, drill monthly in prod.
- **Self-update:** daemon polls signed manifest (minisign) on `cdn.spnr.sh/release/{channel}`; verifies hash; swaps binary; `stable` + `canary` channels; staged rollout percentages server-side. The updater never auto-elevates privileges (user-level install only).

---

## 10. Security & privacy engineering

### 10.1 Threat model (abridged — full doc at spnr.dev/security)

| Threat | Control |
|---|---|
| Malicious creative → terminal escape/injection | charset allow-list both ends; client strips ANSI then rejects; creatives signed; CDN compromise ≠ injection |
| settings.json corruption | atomic write+rename, snapshot, idempotent restore by any binary, watcher re-merge |
| Token/key theft | OS keychain; tokens 24 h, refresh rotation; device key non-exportable where platform allows |
| Supply chain | reproducible builds (cargo + pinned toolchain, `--locked`), published BLAKE3 hashes, minisign-signed releases, install script version-pinned and ≤ 100 lines |
| Payout phishing (spnr.com is not ours) | login/redemption on a single canonical host; CLI opens exact URLs (`spnr redeem`); "we operate only on spnr.sh/.dev/.co" in README + every email; monitor lookalikes |
| Daemon socket abuse by other local processes | socket dir `~/.spnr` mode 0700; datagram schema versioned; daemon rate-limits and treats socket input as untrusted |
| Server breach | client-side signing means historical events can't be forged retroactively without device keys; ledger append-only with offsite WAL archive |

### 10.2 The content firewall (invariant 2, made mechanical)

- `spnr-hook` parses stdin with a hand-rolled extractor that scans for exactly three top-level keys (`hook_event_name`, `session_id`, `timestamp` equivalents) and ignores all other bytes; it links **no** general JSON deserializer for stdin.
- The JSONL session-metadata reader (used only as a reconciliation cross-check, not primary counting) is a separate crate `spnr-meta` whose parser type-level cannot produce strings from `content`/`message`/`text` fields: a CI test walks the crate's AST and fails the build if those field names are ever referenced, and a runtime test feeds canary secrets through fixture transcripts and asserts they never appear in any outbound byte (egress-capture harness).
- Outbound schema is closed-world: the wire structs are the only serializable types; adding a field requires changing the published SAP spec.

### 10.3 Privacy posture (telemetry, exhaustive)

Collected: signed ad events (§4.2), install metadata (os, arch, binary version, adapter), account email. Not collected: anything else — notably no repo names, paths, prompt text, hostnames, usernames. `spnr audit` dumps the raw outbound queue human-readably; the schema is the privacy policy.

---

## 11. Reliability & failure matrix

| Failure | Detection | Behavior | Recovery |
|---|---|---|---|
| Backend unreachable | poll timeout | cached creative within TTL → stock verbs; events queue locally (10 MB bound) | flush on reconnect; `gap` marker if dropped |
| `spnrd` crash | lock heartbeat stale > 60 s | next `spnr-hook`/`spnr-status` invocation restores settings | systemd/launchd restart; queue replays |
| Keychain absent (headless server) | probe at start | daemon runs paused; explicit `--insecure-token-file` opt-in only (documented risk) | n/a |
| Host updates settings schema | parse failure on merge | abort injection, restore snapshot, set PAUSED, surface in `spnr status` | adapter update via self-update |
| `spinnerVerbs` deprecated upstream | serve-time adapter flag | spinner adapter disabled fleet-wide; statusline-only mode | product decision, not an outage |
| Hostile creative approved by mistake | report endpoint + monitoring | killswitch revokes creative id ≤ 60 s | postmortem, lint update |
| Clock skew on device | server compares `t` vs receipt | events outside ±5 min window quarantined, accrue post-review | NTP advice in docs |

SLOs: redirector p99 < 50 ms; serve endpoint p99 < 100 ms; ingest availability 99.9 %; **client-side editor impact: zero** (the only SLO that's an invariant).

---

## 12. Testing strategy

- **Editor-safety suite (the sacred one):** property tests over settings merge (arbitrary valid settings.json ⇒ inject ⇒ restore ⇒ byte-equivalent semantics); crash-injection (kill -9 daemon at random points ⇒ assert config never left sponsored > 60 s); runs on every commit, blocks release.
- **Host replay harness:** a fake Claude Code that replays recorded hook-event timelines + statusline cadence (anonymized timing-only fixtures) ⇒ assert impression counts deterministic and ≤ ground truth.
- **Fraud red-team sims:** scripted attackers (headless loops, heartbeat spammers, replayers, multi-account farms) run against staging weekly; each must land amber/red within published detection windows before launch of paid campaigns.
- **Egress canary tests:** §10.2 runtime harness in CI.
- **Chaos:** CDN poisoning sim (bad signatures), killswitch drills, ledger zero-sum nightly check.

---

## 13. Repo & build layout

```
spnr/ (cargo workspace, AGPL-3.0 client + protocol, ops glue private)
├─ crates/
│  ├─ spnrd/            daemon
│  ├─ spnr-cli/         user CLI
│  ├─ spnr-hook/        hook forwarder (no_std-adjacent, tiny)
│  ├─ spnr-status/      statusline renderer (tiny)
│  ├─ spnr-proto/       SAP wire types, signing, canonical encoding (shared client/server)
│  ├─ spnr-meta/        restricted JSONL timing reader (content-firewalled)
│  └─ adapters/         claude-code-cli, codex-cli, …
├─ server/              ingest, auction, ledger, settle, portal-api, redirector
├─ spec/                SAP/1 protocol RFC (published at spnr.dev)
├─ install/             get.spnr.sh script (≤100 lines, pinned)
└─ ci/                  reproducible-build, editor-safety, egress-canary gates
```

Toolchain: stable Rust, `--locked`, musl static for Linux; macOS universal2; binaries < 10 MB; `spnr-hook`/`spnr-status` < 1 MB stripped. Names to reserve before any announcement: crates.io `spnr` (verified free June 12), npm org `@spnr`, GitHub org.

---

## 14. Milestone acceptance criteria

**v0.1 (week 1):** install→login→sponsored spinner→impressions visible in `spnr status`→redeem $5 credits, end-to-end on a fresh machine in < 2 minutes; editor-safety suite green; killswitch demonstrated; house-ads inventory labeled as such.
**v0.2:** Claude Code plugin install path; Codex adapter; `spnr audit`; SAP/1 RFC published; fraud sims passing; advertiser self-serve with card funding.
**v0.3:** USDC payouts live behind caps; geo/adapter slots; reproducible builds with published hashes; VS Code wrapper.
**v1.0:** x402 agent-buyer API gated on MoltNet reputation; self-host kit (server crates + docker-compose) ; protocol governance doc.

---

## 15. Open engineering questions (tracked, not blockers)

1. Exact hook payload fields per Claude Code version — pin against a tested version matrix; adapter declares supported ranges.
2. Whether statusline invocation cadence is throttled by the host under heavy output — measure; if heartbeat granularity > 2 s, widen the gate window with a published constant.
3. Gift-card/credit fulfillment provider for India + global (Tremendous-class API vs manual codes at small scale) — decide before v0.1 launch since day-one redemption is the wedge.
4. Escrow: custodial address vs minimal on-chain escrow contract — start custodial + published address, contract in v1.0.
5. Windows (WSL works as Linux; native Windows terminal support deferred — keychain + service model differ).

*techspec ends — v1.0, June 12, 2026*
