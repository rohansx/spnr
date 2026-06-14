# spnr — System Architecture

> How the client (developer machine) and the backend fit together: components, hot-path latency budgets, data stores, the three core data flows, the host-adapter abstraction, and the trust boundaries.
> **Status:** Draft v0.3 · June 12, 2026

This document is the C4-ish map of the system. For the protocol on the wire see [SAP/1](03-protocol-SAP1.md); for measurement internals see [the impression engine](04-impression-engine.md); for fraud and attestation see [05-fraud-attestation.md](05-fraud-attestation.md); for the ledger and payout rail see [money & settlement](06-money-settlement.md); for the threat model see [security & privacy](07-security-privacy.md). Cross-cutting risks are tracked in [12-risks-open-questions.md](12-risks-open-questions.md); corrected research with citations lives in [13-research-findings.md](13-research-findings.md).

---

## 1. The six invariants this architecture serves

Every structural choice below derives from the six invariants. They are repeated here because the architecture is an argument about how to honor them, not just a box diagram.

1. **Never degrade the editor/CLI.** spnr failing is invisible to the host. Hot-path binaries have hard latency budgets; a daemon crash restores stock config.
2. **Never read work product.** Code, prompts, completions, paths, repo names, transcript content are structurally unreadable (CI-enforced content firewall, see [07-security-privacy.md](07-security-privacy.md)).
3. **Undercount, never overcount.** Every measurement ambiguity resolves against spnr's revenue.
4. **Machine honest until proven otherwise; network assumes every client is hostile.** Economic truth is established server-side from signed, chained, idempotent events plus server-attributed clicks.
5. **Everything on a user's machine is open source and reproducible.** Published hashes; short, pinned install script.
6. **Fail quiet, fail stock.** No network → cached creative until TTL → stock verbs. Never a stale ad, never an error in the terminal.

---

## 2. High-level topology

```
┌───────────────────────────── developer machine ──────────────────────────────┐
│                                                                               │
│  Claude Code / Codex CLI (unmodified official binary)                         │
│    ├─ hooks (SessionStart/End, Stop, Pre/PostToolUse,        ┌─────────────┐  │
│    │   UserPromptSubmit, Notification) ───────► spnr-hook ───►│             │  │
│    └─ statusLine.command ──────────────────────► spnr-status ►│   spnrd     │  │
│                                                  (OSC 8 link) │  (daemon)   │  │
│  ~/.claude/settings.json  ◄── atomic merge ──────────────────│             │  │
│    (spinnerVerbs, statusLine — GLOBAL scope only)            │  ad cache   │  │
│  ~/.spnr/{state, queue.log, backup.json, lock, sock}  ◄──────│  rotation   │  │
│  OS keychain (auth token, Ed25519 device key) ◄──────────────│  signer     │  │
│                                                              └──────┬──────┘  │
│  spnr (user CLI: login/status/redeem/pause/audit/uninstall) ──socket─┘        │
└──────────────────────────────────────────────────────────────│───────────────┘
                                          HTTPS (batched, signed SAP/1 events)
                                                               ▼
┌──────────────────────────────────── spnr backend ─────────────────────────────┐
│  edge/CDN: signed creatives + killswitch (cdn.spnr.sh)                          │
│  redirector  /c/{code}  302  (latency-critical click path, spnr.sh)            │
│  ┌──────────┐ ┌────────┐ ┌─────────┐ ┌────────┐ ┌────────┐ ┌──────────┐        │
│  │ api-gw   │ │ ingest │ │ auction │ │ ledger │ │ settle │ │ portal-api│        │
│  └────┬─────┘ └───┬────┘ └────┬────┘ └───┬────┘ └───┬────┘ └────┬─────┘        │
│       │           │           │          │          │           │              │
│   ┌───┴───────────┴───────────┴──────────┴──────────┴───────────┴────────┐     │
│   │ Postgres 16 (ledger/control) · Redis (auction head/cache/rate-limit) │     │
│   │ durable buffer (Redis Stream / Kafka) ─► ClickHouse (events/fraud)    │     │
│   │ object storage (audit exports, build artifacts)                      │     │
│   └──────────────────────────────────────────────────────────────────────┘     │
└────────────────────────────────────────────────────────────────────────────────┘
```

The dashed machine boundary is **trust boundary T1** and the HTTPS line is **trust boundary T2** (§9). The only thing crossing T2 from the machine is a stream of signed SAP/1 events; the only thing crossing back is signed creative + a killswitch flag.

> **Research correction:** The official client is used **unmodified**. spnr never exports OAuth subscription tokens and never routes model requests — it only edits the local `spinnerVerbs`/`statusLine` display settings. Anthropic's Jan–Apr 2026 enforcement crackdown targeted harnesses that exported OAuth tokens and spoofed the official client for billing/rate-limit arbitrage; that precedent does not transfer to spnr. Platform risk is real but is a discretionary/continuity gray area, not a likely-shutdown certainty. See [13-research-findings.md](13-research-findings.md) §B and [adr/0004-platform-risk-adapter-abstraction.md](adr/0004-platform-risk-adapter-abstraction.md).

---

## 3. Client components

One Rust workspace produces four binaries. The split exists so the **hot path** (invoked synchronously by the host) carries almost no code, while everything heavy lives in the background daemon.

| Binary | Role | Latency budget | Network? | Heavy parse? |
|---|---|---|---|---|
| `spnrd` | long-running user daemon: ad cache, creative rotation, settings merge, impression state machine, event signing/chaining/queueing, self-update | n/a (background) | yes (batched) | yes (isolated here) |
| `spnr-hook` | invoked by Claude Code hooks; extracts 3 fields, datagrams to daemon, exits | **exit ≤ 50 ms hard** (10 ms typical) | **no** | **no** |
| `spnr-status` | invoked by `statusLine.command` on render; prints one cached line from tmpfs, pings daemon | **exit ≤ 10 ms hard** | **no** | **no** |
| `spnr` | user CLI (login/status/redeem/pause/audit/uninstall); thin client of the daemon socket | interactive | via daemon | n/a |

### 3.1 The hot-path rule (invariant 1)

`spnr-hook` and `spnr-status` are on the synchronous path of the host's UI/turn loop. They MUST:

- do **no** network I/O;
- do **no** JSON deserialization beyond a fixed-field stdin skim (`spnr-hook` uses a hand-rolled extractor that reads only `hook_event_name`, `session_id`, and a timestamp-equivalent — it links no general JSON deserializer, see [07-security-privacy.md](07-security-privacy.md) §content-firewall);
- do **no** allocation-heavy work;
- write a fixed-size datagram to `~/.spnr/spnrd.sock` (`SOCK_DGRAM`, non-blocking, ~5 ms timeout) and exit `0`;
- exit `0` **silently** if the daemon is down or the socket is gone (invariants 1, 6).

```
spnr-hook(stdin) -> extract {event, session, ts_skim}
                 -> sendto(unix_dgram, fixed_frame)   # non-blocking, best-effort
                 -> exit(0)                            # always 0, always fast
```

> **Research correction:** Hook invocation is **not free** — end-to-end hook overhead of ~200 ms has been observed in some setups. The datagram-and-exit design is correct, but real end-to-end hook latency MUST be benchmarked before `spnr-hook` ships default-on; if it adds perceptible latency, make it opt-in or use HTTP hooks. See [13-research-findings.md](13-research-findings.md) §A and [12-risks-open-questions.md](12-risks-open-questions.md).

> **Research correction:** Do **not** trust hook-supplied timestamps. `spnr-hook` forwards what it can, but `spnrd` stamps every event on receipt with its own monotonic + wall clock, because payload timestamp availability is inconsistent across host versions. Also: `Stop` is **not** guaranteed to fire exactly once per `UserPromptSubmit` (interrupts, API errors, blocking hooks can drop it), so wait-interval close must also be driven by a timeout — never assume clean bracketing. See [04-impression-engine.md](04-impression-engine.md).

### 3.2 `spnrd` — what the daemon owns

The daemon is the only client process allowed to be "fat." It owns:

- **Ad cache & rotation** — holds the last few signed creatives within their TTLs; rotates the active creative on `SessionStart` and records `(session_id → creative_id)` so all of a session's impressions attribute to one creative.
- **Settings merge** — the atomic read-merge-write state machine over `~/.claude/settings.json` (§7), plus the inotify/FSEvents watcher.
- **Impression state machine** — the per-session `IDLE → WAITING → TOOL_RUNNING` accrual logic, gated by render-heartbeat liveness (see [04-impression-engine.md](04-impression-engine.md)).
- **Event signing & chaining** — Ed25519 over canonical bytes, per-device monotonic counter, BLAKE3 hash chain, append-only `~/.spnr/queue.log` (see [03-protocol-SAP1.md](03-protocol-SAP1.md)).
- **Batched egress** — flushes signed event batches over HTTPS every ~60 s / on size threshold / on `SessionEnd`.
- **Self-update** — polls a signed release manifest and swaps its own binary; user-level only, never elevates.

The heavy crates (`keyring`, `notify`, `tokio`, `self_update`) are isolated in `spnrd` so the hot-path binaries stay dependency-lean and `<1 MB` stripped.

> **Research correction:** `spnr-hook`/`spnr-status` at `<1 MB` stripped is "ambitious but achievable" only by keeping them to `std` `UnixDatagram` + `blake3` + minimal deps, with `panic=abort`, `opt-level=z`, and a CI size-check gate. See [09-repo-build-layout.md](09-repo-build-layout.md).

> **Research correction:** The OS-keychain device key is **not** non-exportable. The `keyring` crate stores readable secret blobs; the honest claim is "OS-keychain-protected, encrypted-at-rest," not "non-exportable." True hardware-bound keys are a separate, platform-specific hardening track. See [07-security-privacy.md](07-security-privacy.md) §key-custody.

---

## 4. Backend services and what each owns

All services are Rust/`axum`, deliberately boring. Each has a single ownership domain so failures are isolated.

| Service | Owns | Reads / writes |
|---|---|---|
| `api-gw` | TLS termination, auth (device + account), request routing, top-level rate limiting | Redis (rate-limit), session/auth state |
| `ingest` | SAP/1 batch verification: signature → counter monotonicity → chain continuity (`prev`) → ULID dedup → caps → accept | reads Postgres `devices` head; writes raw events to the **durable buffer** (§5) |
| `auction` | serving decisions: single global slot per adapter, open ascending queue (`≥ $1/block`, price-desc/FIFO), anti-self-dealing, frequency caps | Redis (auction head), Postgres (`campaigns`) |
| `ledger` | double-entry, append-only, sum-to-zero accounting; 3-layer idempotency; hold/release | Postgres 16 (system of record) |
| `settle` | x402/USDC advertiser funding + **batched** developer payouts; redemption fulfillment via aggregator rail | Postgres (`redemptions`), on-chain (Base), aggregator API |
| `portal-api` | advertiser self-serve: campaigns, creative submission + lint, live bid board, attestation-coverage dashboards, funding | Postgres (`campaigns`, `creatives`), object storage |
| `redirector` | the `/c/{code}` 302 edge: record click server-side, redirect to allow-listed advertiser URL | Redis (code→URL map, rate-limit), durable buffer (async click record) |

The **redirector** is split out and latency-critical because it sits on a human's click. Target: p99 < 50 ms via a Redis `MultiplexedConnection`, 302-first then async click-fire.

> **Research correction:** Backend scale is conservative. ClickHouse has ~200× headroom at the ~4.6k events/s peak; Postgres runs at ~tens of writes/s per 100k devices with hourly aggregation. The redirector p99 < 50 ms target is realistic. See [13-research-findings.md](13-research-findings.md) §G.

> **Research correction:** Per-impression on-chain settlement is **impossible** — a Base tx (~$0.002–$0.02) dwarfs an impression's value (~$0.000001–$0.00001). `settle` MUST aggregate impressions and settle developer payouts in **batches** (hourly or threshold-based, e.g. ≥ $1–$5). See [adr/0003-x402-batch-settlement-not-per-impression.md](adr/0003-x402-batch-settlement-not-per-impression.md) and [06-money-settlement.md](06-money-settlement.md).

---

## 5. Data stores

| Store | Holds | Why |
|---|---|---|
| **Postgres 16** | ledger (double-entry, append-only), accounts, devices (chain head, ctr head, fraud band), campaigns, creatives, redemptions | strong consistency + constraints are the economic system of record (invariant 4) |
| **Redis** | auction head/queue, creative cache, rate-limit counters, `code → advertiser-URL` map for the redirector | sub-ms hot reads on serving/click paths |
| **ClickHouse** | immutable `events_raw`, fraud feature materializations (5-min) | columnar analytics at 4.6k events/s with headroom |
| **durable buffer (Redis Stream / Kafka)** | landing zone between `ingest`/`redirector` and ClickHouse | **exactly-once ingestion** — never lose or double-count events on ClickHouse hiccups |
| **object storage** | per-account audit exports, signed build artifacts | cheap, durable, user-downloadable (`spnr audit`) |

> **Research correction:** Put an explicit **durable buffer** (Redis Stream or Kafka) between `ingest`/`redirector` and ClickHouse. ClickHouse exactly-once ingestion is a named complexity hot-spot; the buffer decouples accept-from-client (must be reliable) from analytics persistence (can lag). Other hot-spots to design around: the **3-layer idempotency** (ULID PK, `UNIQUE(device_id, ctr)`, `UNIQUE(ledger_ref)`, all `ON CONFLICT DO NOTHING`), **ledger hot-account contention** (shard the house/platform account), and ledger serialization under concurrency. See [13-research-findings.md](13-research-findings.md) §G.

> **Research correction:** Don't hand-roll the ledger. Adopt/port `pgr0ss/pgledger` — an all-in-Postgres, PLpgSQL, ULID-keyed, append-only, sum-to-zero double-entry ledger with per-entry balance snapshots. It matches the spec almost exactly. See [06-money-settlement.md](06-money-settlement.md).

---

## 6. Data-flow walkthroughs

### 6.1 Impression path

```
host hook fires (UserPromptSubmit / Stop / Pre|PostToolUse)
  └► spnr-hook: extract {event, session}, datagram → spnrd, exit 0   (≤50 ms)
spnr-status invoked on render
  └► prints cached line, datagram heartbeat ping → spnrd             (≤10 ms, ≤1 ping/s)
spnrd:
  ├─ stamps event with own monotonic + wall clock (NOT host ts)
  ├─ advances per-session state machine (IDLE↔WAITING↔TOOL_RUNNING)
  ├─ accrues a countable second iff: heartbeat within window
  │   AND session TTY-attested AND not paused                        (invariant 3)
  ├─ on wait-interval close: emit floor(countable_seconds / 5) impressions,
  │   capped (≤60/interval, ≤600/hr/device, ≤4000/day/device)
  └─ sign + chain event → append ~/.spnr/queue.log; batch-flush over HTTPS
backend ingest: verify sig → ctr monotonic → chain prev → ULID dedup → caps
  └► durable buffer → ClickHouse (events_raw) ; ledger imp_earn (50%) + hold T+7d
```

The statusline heartbeat is a **liveness gate**, not core revenue, and not a per-frame attestation (§8 / [04-impression-engine.md](04-impression-engine.md)).

### 6.2 Click path (`/c/{code}` → 302)

```
terminal renders statusline OSC 8 hyperlink → https://spnr.sh/c/{code}?d={device_pub_short}
user clicks (best-effort; OSC 8 is fragile inside the host)
  └► redirector:
       1. resolve code → advertiser URL from Redis (strict server-side allow-list)
       2. 302 redirect IMMEDIATELY                                  (p99 < 50 ms)
       3. async: record (creative, device, ts, ip_class, ua) → durable buffer
       4. dedup window 10 s; per-device/ip-class rate limit; bot-UA filter
clients NEVER self-report billable clicks (client click_hint is UX-only)
```

> **Research correction:** The **spinner is plain-text only and is NOT clickable** — the clickable shortlink lives in the **statusline** OSC 8 link, decoupled from the spinner. OSC 8 inside Claude Code is operationally fragile (OSC-8-stripping regressions; failures in tmux/Konsole), so clicks are a **best-effort bonus signal, not core revenue** — accounting is impression-based and clicks are server-attributed via `/c/{code}`. Emit the close sequence `ESC]8;;ST`, keep URLs short (<2083 bytes, bytes 32–126), enforce strict server-side URL allow-listing. See [13-research-findings.md](13-research-findings.md) §E.

### 6.3 Settlement path

```
advertiser funds campaign:
  card (Stripe, where available) OR x402: POST /v1/fund → 402 challenge
  → USDC transfer to segregated escrow (Base) → credit on 2–3 confirmations
serving: auction picks winning block → creative served (signed, CDN-cached)
accrual: each accepted impression →
  ledger: ad_spend (advertiser escrow → house) + imp_earn (house → dev, 50%) + hold (release T+7d)
settle (batched, NOT per impression):
  └─ hourly / threshold sweep (≥ $1–$5) → developer payout
redemption (≥ $5 minimum):
  └─ DEFAULT: USDC over x402 → user wallet (checksummed addr, test-tx, batched hourly/threshold sweep)
  └─ OFF-RAMP (fiat, dev-initiated): gift card / Amazon / Visa prepaid / local payout / UPI via aggregator (Tremendous)
```

> **Research correction:** Per [ADR-0006](adr/0006-crypto-native-agent-economy-launch-wedge.md) the launch wedge is crypto-native: the **default payout is USDC over x402**, and the gift-card / local-payout rail (**Tremendous**) is the **fiat off-ramp**. The payout mechanism is **NOT "resell API credit codes"** (refuted). You cannot resell Anthropic/OpenAI API credit codes; OpenAI's Service Credit Terms explicitly prohibit transfer/sale/gift/trade of credits (violation triggers revocation + account termination). Any "API credits" story must be indirect and disclosed: pay general-purpose value the developer uses to top up their own provider console. Minimum redemption ≥ $5 to clear gift-card minimums; balances always denominated in USD. See [adr/0001-payout-default-gift-cards-not-api-credits.md](adr/0001-payout-default-gift-cards-not-api-credits.md) and [06-money-settlement.md](06-money-settlement.md).

> **Research correction:** x402 is real and production-ready (Linux Foundation x402 Foundation, formed Apr 2, 2026; originated by Coinbase + Cloudflare + Stripe). Use the **component crates** `x402-axum` (server) and `x402-reqwest` (client) at v1.5.6 — not the stale `x402-rs` umbrella crate. Facilitators do **not** custody funds: advertiser budgets + developer payouts are spnr-owned wallet/escrow/key-custody surface (KYC/AML/money-transmission burden). USDC on Base = `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`; use `alloy-rs`; keep the dual-source depeg breaker. See [06-money-settlement.md](06-money-settlement.md).

---

## 7. Settings mutation (the surface contract)

The daemon owns `~/.claude/settings.json` via an atomic state machine. **Global scope only.**

```
IDLE ──install──► SNAPSHOT (copy user's spinnerVerbs+statusLine → ~/.spnr/backup.json, fsync)
SNAPSHOT ──► INJECTED (atomic: read full file → modify spnr-owned keys → write tmp → fsync → rename)
INJECTED ──external edit──► RE-MERGE (debounce 2s; re-apply iff our keys absent; never touch others)
INJECTED ──user removed our keys twice/24h──► PAUSED (respect the signal; notify via `spnr status`)
INJECTED ──pause/uninstall/killswitch/daemon-stale──► RESTORED (write snapshot back, atomic)
```

Any spnr binary can perform RESTORE (it is idempotent): on socket failure + lock mtime > 60 s, `spnr-hook`/`spnr-status` restore the snapshot themselves. **The config is never left sponsored without a live daemon** (invariant 1).

> **Research correction:** `spinnerVerbs` is an **object** `{ "mode": "replace"|"append", "verbs": [..] }`, not a bare array. Scope precedence is **Managed > Local > Project > User**, so a project-level `.claude/settings.json` CAN override user settings — v1 must detect a project-level override and serve **no** spinner impressions there (don't fight the user's config). The ≤48-char rule is a self-imposed safety constraint (no documented host limit); `spinnerVerbs` is plain-text with no evidence it accepts OSC 8/ANSI. See [13-research-findings.md](13-research-findings.md) §A.

> **Research correction:** Use **two non-overlapping serializers**: RFC 8785 canonical JSON (`serde_json_canonicalizer` / `serde_jcs`) for **signing**, and `serde_json` with `preserve_order` for the **settings.json round-trip**. They must be separate code paths. See [09-repo-build-layout.md](09-repo-build-layout.md).

---

## 8. `HostAdapter` and the spinnerVerbs-deprecation fallback

Platform/continuity risk lives entirely behind one trait, so a host change degrades a single adapter instead of the whole product.

```rust
trait HostAdapter {
    fn inject(&self);                  // apply sponsored surface (settings mutation)
    fn restore(&self);                 // return host to stock config
    fn event_source(&self) -> EventSource; // hooks + statusline cadence for this host
}
```

| Implementation | Ships in | Surfaces |
|---|---|---|
| `claude_code_cli` | v0.1 | spinner (impressions) + statusline (clicks + heartbeat) |
| `codex_cli` | v0.2 | adapter-specific |
| `claude_code_ide` / `vscode` | v0.3 | thin wrapper reusing the same daemon socket |

**Degradation ladder (invariant 6):**

```
spinnerVerbs available ──► spinner impressions + statusline clicks/heartbeat   (full)
spinnerVerbs deprecated/gated ──► spinner adapter disabled fleet-wide,
                                  STATUSLINE-ONLY mode continues               (reduced)
statusLine also unavailable ──► adapter inert; restore stock; surface in status (stock)
```

> **Research correction:** `spinnerVerbs` is a **fragile, possibly-undocumented surface** Anthropic can remove or gate in a single release with no deprecation guarantee — this is the core continuity risk. One research stream found it documented (`code.claude.com/docs/en/settings.md`); another found it described as undocumented/informally shipped (`anthropics/claude-code` issue #21599). Treat it as removable at will; the `HostAdapter` trait + statusline-only fallback is the mitigation. Verify exact doc status by direct test before relying on it. See [13-research-findings.md](13-research-findings.md) §A/§B and [adr/0004-platform-risk-adapter-abstraction.md](adr/0004-platform-risk-adapter-abstraction.md).

> **Research correction:** The statusline is a **coarse liveness GATE**, not a per-frame render heartbeat. It fires on **message boundaries with a ~300 ms debounce**, not per paint; there is no frame-level timestamp in its JSON, so frame-granular "device-signed render attestation" is not buildable. The surviving, real anti-fraud rule: headless `claude -p` runs do **not** invoke statusline → earn nothing. Lean harder on server-side timing-distribution fraud scoring as the moat; the honest advertiser claim is "attested + anomaly-filtered," never "viewability-grade." See [adr/0002-statusline-as-coarse-liveness-gate.md](adr/0002-statusline-as-coarse-liveness-gate.md) and [05-fraud-attestation.md](05-fraud-attestation.md).

> **Research correction:** Plugins (Path B) work: one plugin can register hooks, contribute a statusline command, and bootstrap `spnrd` via a `SessionStart` hook (NOT at install time — there is no arbitrary install-time code exec). Use `${CLAUDE_PLUGIN_ROOT}` / `${CLAUDE_PLUGIN_DATA}`; degrade gracefully if the daemon is slow/absent. See [13-research-findings.md](13-research-findings.md) §A.

---

## 9. Trust boundaries

```
        T1: machine boundary                         T2: network boundary
┌──────────────────────────────┐            ┌─────────────────────────────────┐
│ developer machine            │            │ spnr backend                    │
│ "honest until proven         │ ── SAP/1 ─►│ "assume every client hostile"   │
│  otherwise" (invariant 4)    │  signed    │ (invariant 4)                   │
│                              │  events    │                                 │
│ ◄────── signed creative ─────┼────────────┤ verify sig→ctr→chain→dedup→caps │
│         + killswitch flag    │            │ economic truth lives HERE       │
└──────────────────────────────┘            └─────────────────────────────────┘
```

**Invariant 4 in practice:**

- **On the machine (T1):** the client is trusted enough to sign events with its device key, but its self-reported counts are never economic truth on their own. The content firewall (invariant 2) means even a fully compromised daemon cannot exfiltrate work product — it has no code path to read it.
- **Across the network (T2):** the backend treats every client as hostile. Economic truth is reconstructed server-side from signed, hash-chained, idempotent events (counter monotonicity + `prev` chain + ULID dedup catch replays/forks) plus **server-attributed** clicks (the redirector records the click; clients cannot mint billable clicks).
- **CDN/server compromise must not become terminal injection:** creatives are Ed25519-signed with a pinned key; an invalid signature is treated as a network failure (cached → stock). A compromised CDN cannot push arbitrary text into a user's terminal.

> **Research correction:** Do **not** suppress or spoof host telemetry/heartbeats — that was a detection trigger in the enforcement crackdown. spnr's design constraints follow directly: official binary only, no OAuth token export, no request routing, clear sponsored disclosure, low burn, everything behind the adapter abstraction, and a plan that does not strand accrued user balances if the surface vanishes. See [13-research-findings.md](13-research-findings.md) §B.

---

## 10. Cross-document map

| Concern | Document |
|---|---|
| Product positioning, corrected wedge | [00-product-overview.md](00-product-overview.md) |
| Consolidated engineering spec | [02-technical-spec.md](02-technical-spec.md) |
| Wire protocol, signing, canonical encoding | [03-protocol-SAP1.md](03-protocol-SAP1.md) |
| Impression measurement, caps, state machine | [04-impression-engine.md](04-impression-engine.md) |
| Fraud scoring bands, device identity, attestation | [05-fraud-attestation.md](05-fraud-attestation.md) |
| Ledger, x402/USDC, redemption | [06-money-settlement.md](06-money-settlement.md) |
| Threat model, content firewall, privacy | [07-security-privacy.md](07-security-privacy.md) |
| Editor-safety suite, replay/fraud sims | [08-testing-strategy.md](08-testing-strategy.md) |
| Cargo workspace, crates, verified deps | [09-repo-build-layout.md](09-repo-build-layout.md) |
| Phased plan and sequencing | [10-implementation-plan.md](10-implementation-plan.md) |
| Roadmap and milestone acceptance | [11-phases-roadmap.md](11-phases-roadmap.md) |
| Risk register + open questions | [12-risks-open-questions.md](12-risks-open-questions.md) |
| Validated research with citations | [13-research-findings.md](13-research-findings.md) |
| ADRs 0001–0005 | [adr/](adr/) |

*architecture ends — Draft v0.3, June 12, 2026*
