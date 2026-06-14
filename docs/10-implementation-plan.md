# spnr — Implementation Plan (Build Playbook)

> The phased build playbook: explicit sequencing, dependencies, de-risking spikes, and per-slice definitions-of-done. This is *how* to build it; for *when* (milestone dates and acceptance criteria) see [11-phases-roadmap.md](11-phases-roadmap.md).
> Status: Draft v0.3 · June 12, 2026

---

## 0. How to read this document

This plan is ordered by **dependency**, not by team or component. Work top-to-bottom. Three gates are non-negotiable and block everything downstream of them:

1. **Editor-safety gate** — settings-merge + crash-injection suite must be green before any binary ships to a real `~/.claude/settings.json`. (Invariant 1.)
2. **Content-firewall gate** — the egress-canary harness must prove no work-product byte leaves the machine before any event reaches the network. (Invariant 2.)
3. **Undercount gate** — the impression replay harness must prove counts are deterministic and `≤` ground truth before a single dollar is attributed. (Invariant 3.)

Anything that touches money or the host config without passing its gate is a release-blocker, not a bug.

Cross-references used throughout:
[01-architecture.md](01-architecture.md) ·
[02-technical-spec.md](02-technical-spec.md) ·
[03-protocol-SAP1.md](03-protocol-SAP1.md) ·
[04-impression-engine.md](04-impression-engine.md) ·
[05-fraud-attestation.md](05-fraud-attestation.md) ·
[06-money-settlement.md](06-money-settlement.md) ·
[07-security-privacy.md](07-security-privacy.md) ·
[08-testing-strategy.md](08-testing-strategy.md) ·
[09-repo-build-layout.md](09-repo-build-layout.md) ·
[12-risks-open-questions.md](12-risks-open-questions.md) ·
[13-research-findings.md](13-research-findings.md) ·
[ADR-0001](adr/0001-payout-default-gift-cards-not-api-credits.md) ·
[ADR-0002](adr/0002-statusline-as-coarse-liveness-gate.md) ·
[ADR-0003](adr/0003-x402-batch-settlement-not-per-impression.md) ·
[ADR-0004](adr/0004-platform-risk-adapter-abstraction.md) ·
[ADR-0005](adr/0005-naming-and-domains.md) ·
[ADR-0006](adr/0006-crypto-native-agent-economy-launch-wedge.md)

---

## 1. PRE-WORK (start NOW — parallel to spikes; the legal + custody tracks are now LAUNCH BLOCKERS)

These are acquisition, legal, and custody tasks with external lead times (registration propagation, vendor approval, counsel scheduling, KYB onboarding). Start them on day 0. Per [ADR-0006](adr/0006-crypto-native-agent-economy-launch-wedge.md), the launch wedge is **crypto-native / agent-economy**: the default developer payout is **USDC over x402 (Base)**, with fiat (gift cards / UPI / local via Tremendous) as the **off-ramp, not the default**. That decision pulls three of these tasks — the US money-services/MTL + crypto legal opinion (P6a), wallet/custody/escrow setup (P5), and the KYC/velocity flow (P7) — **onto the v0.1 critical path**. They no longer merely "block launch"; **no real USDC payout ships before P6a + P5 are in place.** Run them in parallel from day one.

| # | Task | Why now / lead time | Owner | DoD |
|---|------|---------------------|-------|-----|
| P1 | Register **`spnr.sh`** and **`spnr.co`** | Both are **UNREGISTERED** as of June 12, 2026 — first-come. Installer host + advertiser portal depend on them. | founder | Both domains owned, DNS + ACME issuing certs. |
| P2 | Confirm **`spnr.dev`** ownership | `spnr.dev` IS registered (Porkbun, 2023-12-06, currently serving 502) — owner **unverified**. Could be founder's or a third party's. | founder | Written confirmation of who controls it; if third party, fallback docs host chosen. |
| P3 | Reserve **crates.io `spnr`** (0.0.1 placeholder), **npm `@spnr` scope**, **GitHub org handle** | crates.io is free (no squat protection — grab it). npm `spnr` is TAKEN (dormant frontend lib v1.8.1) → publish under `@spnr/*`. GitHub `spnr` is a dormant *user* account (id 13784566, not an org) → pick an org handle. | founder | `spnr` 0.0.1 on crates.io; `@spnr` scope owned; GitHub org created under an alternative handle (`spnr-sh` / `spnrhq` / `getspnr`). |
| **P5** | **Wallet / custody / escrow + key management (v0.1 critical path)** | **USDC is the default rail — this is no longer a v0.3 nicety.** spnr owns the wallet/escrow/key surface (facilitators do NOT custody funds). Hot wallet (**MPC/HSM, spend-capped**) + cold reserve; **published segregated escrow address**; **EIP-3009 nonce tracking**; **depeg breaker**. Consider **Coinbase CDP managed wallets** to reduce key-handling risk. KYB onboarding has lead time. | founder + eng | CDP managed-wallet (or custody provider) approved; segregated escrow address minted **and published**; hot/cold split + spend caps live; EIP-3009 nonce store + depeg breaker implemented and tested. |
| P4 | Open **Tremendous** account (fiat off-ramp rail) | ~1–2 business-day production approval; sandbox available immediately. The off-ramp is a first-class fallback for non-crypto / tax-sensitive developers (notably India) — it must be ready at v0.1 alongside the USDC default. | founder | Sandbox key in hand; production application submitted. |
| **P6a** | **US money-services/MTL + crypto legal opinion (v0.1 LAUNCH BLOCKER)** | **Paying out USDC likely makes spnr a money transmitter / MSB** ([13-research-findings.md](13-research-findings.md) §I). Per [ADR-0006](adr/0006-crypto-native-agent-economy-launch-wedge.md) this is the single biggest cost of the crypto-native wedge and is now a **pre-launch** gate, not a later one. Engage day 0; it runs in parallel with the whole v0.1 build. | founder | Written MSB/MTL + crypto opinion in hand (federal registration posture + state MTL exposure + exemption analysis) **before the first real USDC payout**. Tracked in [12-risks-open-questions.md](12-risks-open-questions.md). |
| P6b | Scope the remaining counsel tracks | Each gates a specific phase; engage before that phase. | founder | Engagement letters or scoped quotes for the India-CA, advertising, and commercial/IP tracks (see below). |
| **P7** | **KYC/AML + velocity-limit flow for USDC payouts (v0.1 critical path)** | KYC/AML and velocity limits attach to USDC payouts above thresholds ([ADR-0006](adr/0006-crypto-native-agent-economy-launch-wedge.md)). The redemption flow (S11) must be designed for them from the start, not retrofitted. | founder + eng | Tiered KYC/velocity policy defined; redemption flow enforces thresholds before any real USDC leaves escrow. |

> **Research correction:** the source spec listed `spnr.sh` and `spnr.co` as "owned" — RDAP on June 12, 2026 shows both **unregistered**. Register both immediately. The wedge was also stated as redeeming into "Anthropic/OpenAI API credit codes"; you **cannot** resell those (OpenAI's Service Credit Terms prohibit transfer/sale and revoke credits + terminate the account for it). API-credit-code resale stays prohibited under [ADR-0001](adr/0001-payout-default-gift-cards-not-api-credits.md). See [ADR-0005](adr/0005-naming-and-domains.md) and [13-research-findings.md](13-research-findings.md).

> **Wedge correction (per [ADR-0006](adr/0006-crypto-native-agent-economy-launch-wedge.md)):** earlier drafts framed **gift cards as the default day-one payout**. That is superseded: the **default is now USDC over x402 (Base) to a user wallet**, and gift cards / UPI / local payouts via Tremendous are the **fiat off-ramp** for developers who prefer fiat or are in tax-sensitive jurisdictions. This is honest about the cost — USDC raises **real MSB/MTL friction** (P6a) and **real India VDA/TDS friction** (taxed as income on receipt at zero basis, then 30% s.115BBH + 1% s.194S TDS on transfer) — which is exactly why the off-ramp is retained and surfaced, not hidden.

### 1.1 Legal counsel tracks (from [12-risks-open-questions.md](12-risks-open-questions.md); informational, not legal advice)

| Track | Engage before | Question |
|-------|---------------|----------|
| **US MSB/MTL + crypto (PRE-LAUNCH, P6a)** | **the first real USDC payout — i.e. v0.1** | USDC = convertible virtual currency → federal MSB registration + state MTL exposure. Per [ADR-0006](adr/0006-crypto-native-agent-economy-launch-wedge.md), USDC is now the **default** rail, so this opinion is a **v0.1 launch blocker** run in parallel from day 0 — not a v0.3 gate. |
| Indian CA | India payouts | A user *earning* USDC likely owes ordinary income tax on receipt (zero basis), THEN 30% (s.115BBH) + 1% TDS (s.194S) on transfer. The "30% + 1% TDS" copy understates the receipt event. In-flow VDA/TDS disclosure is mandatory for the Indian supply side; the fiat off-ramp exists partly to give them a lower-friction choice. |
| Advertising counsel | any earnings claim ("pays for your Claude sub", "$X/mo") | FTC 16 CFR Part 255 disclosure; Business Opportunity Rule + 2025 earnings-claims rulemaking need written substantiation + "results not typical". |
| Commercial / IP | the credit-resale question (if ever revisited) | Confirm the indirect-value model (pay general-purpose value the dev uses to top up *their own* console) is clean. |

> **Regulatory-load note (changed by [ADR-0006](adr/0006-crypto-native-agent-economy-launch-wedge.md)):** the crypto-native wedge deliberately accepts higher regulatory load in exchange for a more defensible position. The USDC default puts MSB/MTL on the critical path (P6a). The **fiat off-ramp** keeps a lower-load posture available: **closed-loop gift cards**, per-user daily redemption **< $2,000** (FinCEN closed-loop + small-program exclusions), disbursed via the licensed vendor so it carries gift-card/escheat/AML. See [06-money-settlement.md](06-money-settlement.md).

---

## 2. DE-RISKING SPIKES (do these FIRST — before committing the v0.1 architecture)

Every spike below tests an assumption the whole build rests on. Run them against **Claude Code 2.1.175** (the version confirmed running locally) on a throwaway machine. Each spike is timeboxed (≤1 day) and produces a written finding logged in [13-research-findings.md](13-research-findings.md). **If a spike fails, the dependent slice's design changes before code is written.**

| Spike | Question | Method | Pass criteria | If it fails |
|-------|----------|--------|---------------|-------------|
| **S1** | Does `spinnerVerbs` accept the `{mode,verbs}` object on live CC, and what is the real char limit? | Write `{"spinnerVerbs":{"mode":"replace","verbs":["sponsored — example ↗"]}}` to `~/.claude/settings.json`; start an interactive session; observe. Sweep verb length 1→200 chars. | Object form renders; precedence Managed>Local>Project>User confirmed; note any truncation point. | If only a bare array works, or the key is silently ignored, the spinner adapter is non-viable → fall back to **statusline-only** ([ADR-0004](adr/0004-platform-risk-adapter-abstraction.md)). |
| **S2** | What is real end-to-end **hook latency** (`spnr-hook` datagram + exit)? | Register a SessionStart/Stop/PostToolUse hook calling a stub `spnr-hook`; measure wall-clock added to the turn over 100 turns. | Added latency imperceptible (target well under the observed ~200 ms hook overhead ceiling). | If it adds perceptible latency, make hooks **opt-in** or switch to **HTTP hooks** ([04-impression-engine.md](04-impression-engine.md)). |
| **S3** | What is the real **statusLine invocation cadence**? | Register `statusLine.command` = a logger; drive a session with long waits + heavy output; record inter-invocation intervals. | Establish the actual debounce/cadence; derive the gate-window constant. | If cadence is coarser than ~2 s under load, **widen the gate window** with a published constant ([04-impression-engine.md](04-impression-engine.md) §; spec §15 Q2). |
| **S4** | Does an **OSC 8 statusline click** survive the current CC version (and tmux)? | Emit `ESC]8;;https://spnr.sh/c/TEST ST link ESC]8;;ST` from `spnr-status`; click in iTerm2/kitty/WezTerm and inside tmux. | At least bare-terminal click opens the URL; record which terminals strip it. | Clicks become a **best-effort bonus only** (already the design) — revenue stays impression-based ([05-fraud-attestation.md](05-fraud-attestation.md)). |

> **Research correction:** the source spec treated statusLine as a per-frame "render heartbeat" where each invocation == one human-visible paint. It is NOT per-frame — it fires on **message boundaries with a ~300 ms debounce**, has no frame-level timestamp, and has known mid-session-stop (#43826) and OSC-8-stripping regressions. Treat it as a **coarse liveness gate**, not a heartbeat, and lean harder on server-side timing-distribution fraud scoring. S3/S4 measure the real cadence. See [ADR-0002](adr/0002-statusline-as-coarse-liveness-gate.md).

> **Research correction:** `spinnerVerbs` may be **undocumented / informally shipped** (anthropics/claude-code #21599) and removable in a single release with no deprecation guarantee — one research stream found it documented at code.claude.com, another did not. S1 verifies doc status by direct test. This is the core continuity risk and the reason the `HostAdapter` trait exists ([ADR-0004](adr/0004-platform-risk-adapter-abstraction.md)).

---

## 3. v0.1 CRITICAL PATH — tracer-bullet vertical slices

The v0.1 goal (acceptance in [11-phases-roadmap.md](11-phases-roadmap.md)): on a fresh machine, **install → login → sponsored spinner → impressions visible in `spnr status` → redeem to USDC wallet (default) or $5 gift card (fiat off-ramp), end-to-end in < 2 minutes**, with the editor-safety suite green and the killswitch demonstrated.

> **What [ADR-0006](adr/0006-crypto-native-agent-economy-launch-wedge.md) moved into this critical path — and why it lengthens v0.1.** Because USDC over x402 (Base) is now the **default** payout, the **x402 settlement rail** (`x402-axum` / `x402-reqwest`, `alloy-rs`, USDC on Base) is part of the v0.1 critical path (new slice **S11a**), not a v0.3 add-on. The default v0.1 redemption is **USDC-to-wallet, with the Tremendous fiat off-ramp as the alternative** (S11b). This is gated on the pre-work that also moved earlier: **no real USDC payout ships before the MSB/MTL + crypto legal opinion (P6a) and the wallet/custody/escrow setup (P5) are in place, with the KYC/velocity flow (P7) wired in.** Accept that this **lengthens v0.1** relative to the gift-cards-only framing — that lengthening is the deliberate cost of the crypto-native wedge.

Each slice below is a thin end-to-end tracer bullet with its own definition-of-done (DoD). Build in this exact order — each slice depends on the ones above it. Risk-ordered call-outs flag the non-negotiable gates.

### Dependency graph (build order)

```
S0 workspace+CI
   └─► S1 spnr-proto (signing, canonical, SAP types)
          ├─► S2 spnr-hook + spnr-status (hot path)        ◄── gated by spike S2/S3/S4
          └─► S3 spnrd settings-merge state machine        ◄── EDITOR-SAFETY GATE
                 └─► S4 spnrd impression engine + queue     ◄── UNDERCOUNT GATE + CONTENT-FIREWALL GATE
                        └─► S5 backend ingest + verify
                               └─► S6 auction (single slot)
                                      └─► S7 ledger (pgledger)
                                             ├─► S8 redirector (/c/{code})
                                             └─► S9 installer (curl)
                                                    └─► S10 GitHub device-flow auth
                                                           └─► S11a x402/USDC settlement rail (DEFAULT)   ◄── P5 custody + P6a MSB/MTL opinion + P7 KYC
                                                                  └─► S11b redemption: USDC wallet (default) / Tremendous (off-ramp)
                                                                         └─► S12 end-to-end < 2 min on fresh machine
```

---

### S0 — Cargo workspace + CI skeleton

- **Build:** workspace per [09-repo-build-layout.md](09-repo-build-layout.md): crates `spnrd`, `spnr-cli`, `spnr-hook`, `spnr-status`, `spnr-proto`, `spnr-meta`, `adapters/`; `server/`; `install/`; `ci/`. `--locked`, pinned stable toolchain. CI gates wired empty-but-present: editor-safety, egress-canary, binary-size-check (`spnr-hook`/`spnr-status` < 1 MB stripped), `cargo-zigbuild` musl + macOS `lipo`.
- **Risk call-out:** the **size-check** and **egress-canary** gates exist from commit 1 so they never become retrofits.
- **DoD:** `cargo build --locked --workspace` green on linux-musl + macOS; CI runs all (initially trivial) gates; `spnr` 0.0.1 placeholder published (P3).

### S1 — `spnr-proto`: signing, canonical encoding, SAP/1 types

- **Build:** wire structs from [03-protocol-SAP1.md](03-protocol-SAP1.md) §4.2 (`v, id(ULID), ctr, prev(BLAKE3), t, type, session, creative, n`); Ed25519 sign/verify (`ed25519-dalek` 2.x, pin 2.x — 3.0 still rc); **canonical JSON for signing via `serde_jcs`/`serde_json_canonicalizer` (RFC 8785)**; per-device hash chain (`prev`) + monotonic `ctr`.
- **Risk call-out — two serializers, non-overlapping:** the **canonical (signing)** path and the **settings.json round-trip** path are *separate code paths*. Signing uses RFC-8785 canonicalization; settings round-trip uses `serde_json` with `preserve_order`. Never share a serializer between them.
- **DoD:** round-trip + signature verify tests pass; canonical bytes are byte-stable across runs; chain-continuity unit tests (gap/fork detection) pass; shared cleanly by client and server.

### S2 — `spnr-hook` + `spnr-status` (hot path)

- **Depends on:** S1, spikes S2/S3/S4.
- **Build:** `spnr-hook` — restricted stdin extractor pulling **only** `{hook_event_name, session_id, timestamp-equivalent}`, no general JSON deserializer linked; writes fixed-size datagram to `~/.spnr/spnrd.sock` (SOCK_DGRAM, non-blocking, 5 ms timeout), exits **0** always. `spnr-status` — prints one cached line from `~/.spnr/statusline.cache` (tmpfs where available), emits OSC 8 link with explicit close `ESC]8;;ST`, coalesced liveness ping ≤1/sec.
- **Risk call-outs:**
  - **Hot-path latency is an invariant** (exit ≤ 50 ms hook / ≤ 10 ms status). Keep deps to `std` UnixDatagram + `blake3` + minimal — no `tokio`/`keyring`/`notify` here.
  - **Stamp time on daemon receipt, not from the hook payload** — payload timestamp availability is inconsistent across CC versions; capture monotonic + wall-clock at the daemon.
  - **Hooks must `exit 0`** — exit-code-2 blocking semantics do NOT apply uniformly (e.g. not to PostToolUse). Never block the host.
  - **`Stop` is not guaranteed once per `UserPromptSubmit`** — interrupts/API errors/blocking hooks can drop it. The wait-interval close must ALSO be timeout-driven (≤60 imp/interval cap already does this). Never assume clean bracketing.
- **DoD:** both binaries < 1 MB stripped (CI gate); end-to-end hook latency within the S2-spike budget; daemon-down case exits 0 silently; restricted extractor proven to ignore all non-allowed keys (unit + fuzz).

### S3 — `spnrd` settings-merge state machine + editor-safety suite

- **Depends on:** S1.
- **Build:** the [02-technical-spec.md](02-technical-spec.md) §2.3 state machine `IDLE→SNAPSHOT→INJECTED→{RE-MERGE,PAUSED,RESTORED}`. Atomic write: read full file → `serde_json::Value` with `preserve_order` → modify only spnr-owned keys → temp file in same dir → fsync → `rename(2)`. Snapshot original `spinnerVerbs`+`statusLine` to `~/.spnr/backup.json`. inotify/FSEvents watcher, 2 s debounce, re-merge only if our keys were lost. Stale-lock guard (mtime > 60 s) lets ANY spnr binary perform an idempotent RESTORE.
- **Build the project-override detector:** if a project-level `.claude/settings.json` overrides `spinnerVerbs`, serve **no** spinner impressions there.
- **Risk call-out — EDITOR-SAFETY GATE (non-negotiable):** the [08-testing-strategy.md](08-testing-strategy.md) editor-safety suite must be GREEN before this binary touches a real settings file:
  - property test: arbitrary valid `settings.json` ⇒ inject ⇒ restore ⇒ byte-equivalent semantics (other keys untouched);
  - crash-injection: `kill -9` the daemon at random points ⇒ config never left sponsored > 60 s.
- **DoD:** editor-safety suite green and wired to block release; double-removal-in-24h → PAUSED; killswitch/pause/uninstall/daemon-stale all RESTORE; project-override detection verified.

> **Research correction:** because precedence is **Managed > Local > Project > User**, a project-level config legitimately overrides the user's — v1 must detect that and stand down there rather than fight it ([02-technical-spec.md](02-technical-spec.md) §2.1).

### S4 — `spnrd` impression engine + queue

- **Depends on:** S2, S3.
- **Build:** per-session state machine `IDLE→WAITING→TOOL_RUNNING` ([04-impression-engine.md](04-impression-engine.md)). Accrual per 1 s tick while WAITING: `countable := (liveness-gate within widened window) && session.tty_attested && !paused`; emit `floor(countable_seconds / 5)` per wait-interval close. Caps: ≤60/interval, ≤600/hr/device, ≤4,000/day/device, **one device = one concurrent counting session**. Creative rotation on **SessionStart**; attribute all of a session's impressions to one creative. Append-only `~/.spnr/queue.log` (length-prefixed, fsync per batch, 10 MB bound, oldest-drop with explicit `gap` marker). `spnr-meta` JSONL reader as reconciliation cross-check only.
- **Risk call-outs:**
  - **UNDERCOUNT GATE:** the replay harness ([08-testing-strategy.md](08-testing-strategy.md)) must show counts are deterministic and **≤ ground truth** on recorded timing-only fixtures before any attribution. TOOL_RUNNING time never counts; partial trailing seconds drop.
  - **CONTENT-FIREWALL GATE (non-negotiable):** `spnr-meta`'s parser must be structurally unable to read `content`/`message`/`text` — CI AST deny-list test + runtime canary-secret egress test must pass. No event reaches the queue until this is green.
- **DoD:** replay harness deterministic + undercounting; content-firewall CI gates green; caps enforced client-side as a superset of server caps; liveness-gate window uses the S3-spike constant.

### S5 — Backend ingest + verify

- **Depends on:** S1 (shared `spnr-proto`), S4 (events to ingest).
- **Build:** `axum` 0.8 `POST /v1/ingest` (signed batch envelope, gzip, ≤500 events). Verification order: signature → counter monotonicity → chain continuity (`prev` == stored head) → ULID dedup → caps → accept into `events_raw`. Put a **durable buffer (Redis stream)** between ingest and ClickHouse for exactly-once. **Stamp receipt time server-side**; quarantine events outside ±5 min of receipt.
- **Risk call-out:** ClickHouse exactly-once ingestion is a known hot-spot — the durable buffer is mandatory, not optional ([01-architecture.md](01-architecture.md)).
- **DoD:** valid signed batch accepted + deduped; bad sig / chain fork / counter regression flags the device (no auto-ban); replayed batch is idempotent (no double-insert); `SQLX_OFFLINE` CI build green.

### S6 — Auction (single slot)

- **Depends on:** S5.
- **Build:** single global slot per adapter ([02-technical-spec.md](02-technical-spec.md) §6.1). Open ascending queue, `price_per_block ≥ $1`, block = 1,000 impressions, serving order price-desc/FIFO. Anti-self-dealing join (advertiser_account × device_account → unpaid/unbilled). Signed `GET /v1/serve` creative payload (Ed25519, pinned key + backup) with `killswitch` flag. v0.1 seeds **house ads, labeled as such**.
- **Risk call-out:** model economics against the **$0.001/impression floor** ($1/block), not the $0.011 one-tester rate — assume near-zero real advertiser demand at launch.
- **DoD:** serve endpoint returns signed creative; invalid signature treated as network failure (cached → stock); killswitch flips payload to null ≤60 s; self-dealing matches excluded.

> **Research correction:** the source spec cited "~614K launch-day views", "$0.011/impression", and "overwhelmingly positive" for Kickbacks.ai. Reality: a single viral X post (cited 556K–614K); $0.011 is one tester's observed rate (not a posted price — the $1/block floor implies **$0.001/impression**); sentiment was ~74% positive / ~26% negative across ~336 comments. Plan against the floor and possible near-zero demand. See [13-research-findings.md](13-research-findings.md).

### S7 — Ledger (pgledger)

- **Depends on:** S5, S6.
- **Build:** adopt/port **`pgr0ss/pgledger`** — all-in-Postgres, PLpgSQL, ULID-keyed, append-only, sum-to-zero double-entry with per-entry balance snapshots ([06-money-settlement.md](06-money-settlement.md)). Per accepted impression: `ad_spend` (advertiser→house) + `imp_earn` (house→dev, 50%) + `hold` releasing T+7d. Aggregate impressions into hourly `imp_earn` entries (keeps Postgres at tens of writes/s). **3-layer idempotency as Postgres constraints:** ULID PK, `UNIQUE(device_id, ctr)`, `UNIQUE(ledger_ref)`, all `ON CONFLICT DO NOTHING`. Shard the house/platform account to avoid hot-account contention.
- **Risk call-out:** ledger hot-account contention + serialization under concurrency are known hot-spots — shard the house account from day one.
- **DoD:** nightly zero-sum invariant check green; no `release` without matching `hold`; replayed economic event never double-credits (constraint-enforced); reuse pgledger rather than hand-rolling.

> **Research correction:** the wedge is **batch settlement**, not per-impression on-chain. A Base tx (~$0.002–$0.02) dwarfs an impression's value (~$0.000001–$0.00001), so per-impression settlement is economically impossible. Aggregate and settle developer payouts in batches (hourly / ≥$1–$5 threshold). See [ADR-0003](adr/0003-x402-batch-settlement-not-per-impression.md).

### S8 — Redirector (`/c/{code}`)

- **Depends on:** S6 (creatives + short codes).
- **Build:** latency-critical edge `GET https://spnr.sh/c/{short_code}?d={device_pub_short}` → **302 first**, then async fire the click record `(creative, device, ts, ip_class, ua)`. Redis `MultiplexedConnection`. **Strict server-side URL allow-list** (advertiser domains verified). Dedup window 10 s, per-device/ip-class rate limits, bot-UA filtering. **Clients never self-report billable clicks** — `click_hint` is UX-only.
- **Risk call-out:** clicks are a **best-effort bonus**, server-attributed; revenue accounting stays impression-based ([05-fraud-attestation.md](05-fraud-attestation.md)).
- **DoD:** p99 < 50 ms; non-allow-listed URL rejected; double-click within 10 s deduped; 302 issued before the click write completes.

### S9 — Installer (curl)

- **Depends on:** S2, S3, S4 (the binaries it installs), P1 (`spnr.sh`).
- **Build:** `curl -fsSL https://get.spnr.sh | sh`, ≤100 lines, version-pinned, readable. Detect OS/arch; download binary; **verify published BLAKE3 hash + signature**; install to `~/.local/bin`; register systemd user unit (Linux) / launchd agent (macOS) by writing the unit/plist and shelling `systemctl --user` / `launchctl bootstrap`; run `spnr login`; perform settings injection (S3); print first-run summary. README shows the manual equivalent for `curl | sh` skeptics.
- **Risk call-out — signature verification:** `self_update` verifies **zipsign (ed25519), NOT minisign**. Either use its native zipsign path, or download + verify with `minisign-verify` yourself then swap the binary (disable `self_update`'s sig feature). Do not assume minisign pairs out of the box.
- **DoD:** fresh-machine install verifies hash+sig, registers the service, and reaches a paused-but-ready daemon; tampered binary is rejected; script ≤100 lines and pinned.

> **Research correction:** "non-exportable keys" is FALSE for the `keyring` crate — it stores readable secret blobs. Downgrade the claim to **"OS-keychain-protected, encrypted-at-rest."** True non-exportable / Secure-Enclave keys need `security-framework` FFI + codesigning (a separate hardening track). See [07-security-privacy.md](07-security-privacy.md).

### S10 — GitHub device-flow auth

- **Depends on:** S9, S1 (device key).
- **Build:** `spnr login` runs GitHub device flow fully in-terminal (CLI prints the exact URL — never typed by the user; anti-phishing posture, [07-security-privacy.md](07-security-privacy.md)). Generate the Ed25519 device key, seal token + key in OS keychain (`keyring` 4.0.1). Server binds `device_id → account_id`. Tokens 24 h with refresh rotation. Keychain-absent (headless) → daemon runs paused, `--insecure-token-file` opt-in only.
- **DoD:** login binds device to account server-side; secrets in keychain (encrypted-at-rest, threat model documented); CLI opens the canonical URL itself; headless box degrades to paused.

### S11a — x402 / USDC settlement rail (DEFAULT — v0.1 critical path)

- **Depends on:** S7 (ledger balance), S10 (authenticated account), **P5 (custody/escrow + key management), P6a (MSB/MTL + crypto legal opinion), P7 (KYC/velocity flow)**.
- **Hard gate — no real USDC payout before P5 + P6a (per [ADR-0006](adr/0006-crypto-native-agent-economy-launch-wedge.md)):** this slice may be built and exercised against **testnet / Base sandbox** at any time, but **mainnet USDC cannot leave escrow until the MSB/MTL + crypto legal opinion (P6a) is in hand and the custody/escrow surface (P5) is live.** Treat that as a release-blocker on par with the editor-safety / content-firewall gates for the money path.
- **Build:** the x402-native settlement rail — **`x402-axum`** (server bid/settle surface) + **`x402-reqwest`** (client), **`alloy-rs`** for Base, **USDC on Base**. Pay out developer balances from the **published segregated escrow address** (P5) using **EIP-3009** transfer-with-authorization (nonce-tracked, P5). Batch settlement only (hourly / ≥$1–$5 threshold) — per-impression on-chain is impossible. Enforce the **depeg breaker** (P5) and **KYC/velocity limits** (P7) before any transfer authorization. Balances stay **USD-denominated** in the ledger; USDC is the settlement of that balance.
- **Risk call-out — custody is the load-bearing surface:** facilitators do NOT custody funds — spnr owns the wallet/escrow/key risk. Hot (MPC/HSM, spend-capped) + cold reserve, EIP-3009 nonce tracking, and the depeg breaker all gate the first mainnet payout (P5).
- **DoD:** end-to-end batch USDC payout succeeds on **Base testnet** from the escrow address via EIP-3009; nonce reuse rejected; depeg breaker halts payouts on threshold breach; KYC/velocity thresholds enforced; **mainnet path remains disabled in CI/config until P6a + P5 sign-off**. (Per-impression on-chain remains impossible — batch only, see the S7 correction and [ADR-0003](adr/0003-x402-batch-settlement-not-per-impression.md).)

### S11b — Redemption: USDC wallet (default) + Tremendous (fiat off-ramp)

- **Depends on:** S11a (USDC rail), S7 (ledger balance), S10 (authenticated account), P4 (Tremendous account).
- **Build:** `spnr redeem` offers two paths. **Default: USDC-to-wallet** over the S11a x402/USDC rail to a user-supplied wallet. **Fiat off-ramp (alternative, first-class, one-tap):** interactive gift-card / local-payout redemption via **Tremendous** (sandbox first, then production) for developers without a wallet or in tax-sensitive jurisdictions (notably India) — onboarding must make "no wallet? get paid in a gift card / UPI instead" an obvious choice so wallet friction does not throttle supply. Minimum redemption threshold **$5** (clears gift-card minimums/fees); balances denominated in **USD** always; per-user daily cap **< $2,000** on the fiat off-ramp (closed-loop posture); KYC/velocity limits (P7) on the USDC path. Idempotent via client-supplied key. Ledger writes `redeem`; delivered in-CLI / on-chain and by email.
- **Intellectual-honesty call-out (India / VDA):** the USDC default is **heavier**, not lighter, for an Indian developer — USDC receipt is taxed as income on receipt (slab rates, zero basis), then 30% (s.115BBH) + 1% TDS (s.194S) on transfer. In-flow VDA/TDS disclosure is mandatory; the fiat off-ramp is retained precisely so the headline-market supply side is not driven away. Do not hide this.
- **Risk call-out — no API credit codes:** redemption pays **general-purpose value** (USDC / Amazon / Visa prepaid / local gift card / USD). Any "use it for API credits" story is **indirect and disclosed** (the dev tops up their OWN provider console) — never mint or resell credit codes.
- **DoD:** default USDC-wallet redemption succeeds end-to-end on the S11a (testnet) rail; fiat off-ramp sandbox redemption of a $5 gift card succeeds end-to-end; below-threshold redemption refused; double-submit idempotent (no double-spend); India fiat off-ramp validated against the licensed-vendor rail; VDA/TDS disclosure shown on the USDC path.

### S12 — End-to-end < 2 min on a fresh machine

- **Depends on:** S0–S11b.
- **Build:** the full tracer bullet on a clean VM/container: `curl | sh` → `spnr login` (GitHub device flow) → sponsored spinner appears → run a session → impressions appear in `spnr status` → `spnr redeem` to a **USDC wallet** on the S11a rail (Base testnet for the demo) **or** a **$5 gift card via the Tremendous sandbox** (fiat off-ramp). Demonstrate the **killswitch** blanking creatives ≤60 s and reverting to stock verbs. Confirm house-ads inventory is labeled as such.
- **Risk call-out:** all three gates (editor-safety, content-firewall, undercount) must be green in CI for this to count as done — a fast demo over a broken gate is not v0.1. The **mainnet USDC payout stays disabled until P6a (MSB/MTL opinion) + P5 (custody) sign-off** — the v0.1 demo runs the default rail on **testnet**.
- **DoD:** total wall-clock < 2 minutes on a fresh machine; both redemption paths exercised (USDC-wallet default on testnet + Tremendous off-ramp sandbox); editor-safety suite green; killswitch demonstrated; matches the v0.1 acceptance criteria in [11-phases-roadmap.md](11-phases-roadmap.md).

---

## 4. Risk-ordered gate summary (the non-negotiables)

| Gate | Blocks | Where enforced | Invariant |
|------|--------|----------------|-----------|
| **Editor-safety** (settings merge + crash-injection) | S3 and everything downstream that touches `settings.json` | [08-testing-strategy.md](08-testing-strategy.md), CI every commit | 1 |
| **Content-firewall** (AST deny-list + canary egress) | S4 and any event reaching the network | [07-security-privacy.md](07-security-privacy.md) §, CI | 2 |
| **Undercount** (deterministic replay, ≤ ground truth) | S4 attribution, S5–S7 money | [08-testing-strategy.md](08-testing-strategy.md) replay harness | 3 |
| **Server-side economic truth** (signed/chained/idempotent + server-attributed clicks) | S5–S8 | ingest verify + redirector | 4 |
| **Reproducible + open** (published BLAKE3, ≤100-line install) | S9 | [09-repo-build-layout.md](09-repo-build-layout.md) | 5 |
| **Fail-stock** (no network → cache → stock verbs) | S3, S6 | settings state machine + serve | 6 |

---

## 5. What is explicitly NOT in v0.1 (deferred — see [11-phases-roadmap.md](11-phases-roadmap.md))

- Codex CLI adapter, Claude Code **plugin** distribution (Path B), `spnr audit`, SAP/1 RFC publication, fraud-scoring v1, advertiser self-serve portal → **v0.2**.
- Geo/adapter targeting slots, reproducible-build hash publication, VS Code wrapper → **v0.3**.
- x402 **agent-buyer** API + its native self-contained gate (x402 payment-as-gate + same creative lint + human-review queue for first-time buyers + on-platform buyer reputation), self-host kit → **v1.0**.
- Browser wait-state surface → **Phase 3** (conditional go/no-go).

> **Moved INTO v0.1 by [ADR-0006](adr/0006-crypto-native-agent-economy-launch-wedge.md):** the **USDC/x402 settlement rail and USDC-default redemption** are no longer a deferred v0.3 tier — they are the v0.1 critical path (S11a/S11b), gated on the legal opinion (P6a) + custody (P5) + KYC (P7) that also moved to pre-launch. The **agent-buyer x402 API** is the foregrounded *narrative* from launch but its full `POST /v1/bids → 402` surface still matures to **v1.0**; what is x402-native from v0.1 is the **settlement rail**, so the story is true rather than aspirational.

Open engineering questions that can change the plan are tracked in [12-risks-open-questions.md](12-risks-open-questions.md) (e.g. exact hook payload fields per CC version, statusline cadence under load, custodial-vs-contract escrow, native Windows support).

*implementation plan ends — Draft v0.3, June 12, 2026*
