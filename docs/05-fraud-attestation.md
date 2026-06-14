# 05 — Anti-Fraud & Attestation

> The moat, honestly scoped: device-signed chained events + server-side anomaly scoring, surfaced to advertisers as attestation coverage and a fraud-filter rate.
> **Status:** Draft v0.3 · June 12, 2026

This document specifies how spnr establishes economic truth about terminal impressions despite assuming **every client is hostile** (invariant 4). The client produces signed, chained, idempotent evidence; the server decides what is real. The deliverable advertisers buy is *attested + anomaly-filtered* inventory — **never IAB-viewability-grade**.

Related: [03-protocol-SAP1.md](03-protocol-SAP1.md) (wire format), [04-impression-engine.md](04-impression-engine.md) (how seconds become impressions), [06-money-settlement.md](06-money-settlement.md) (how scores gate payout), [07-security-privacy.md](07-security-privacy.md) (content firewall + threat model), [08-testing-strategy.md](08-testing-strategy.md) (red-team sims), [12-risks-open-questions.md](12-risks-open-questions.md), [13-research-findings.md](13-research-findings.md), [adr/0002-statusline-as-coarse-liveness-gate.md](adr/0002-statusline-as-coarse-liveness-gate.md).

---

## 1. Trust model

```
┌────────────────── developer machine (UNTRUSTED) ───────────────────┐
│  device key (Ed25519, keychain)                                     │
│  per-device hash chain: ctr↑ + ULID + BLAKE3(prev)                  │
│  → signed event batches                                             │
└───────────────────────────────┬────────────────────────────────────┘
                                 │ HTTPS, signed, batched
                                 ▼
┌────────────────── spnr backend (TRUSTED) ──────────────────────────┐
│  ingest: verify sig → ctr monotonic → chain continuity → ULID dedup │
│  fraud: ClickHouse features (5-min materialize) → score ∈ [0,1]     │
│  bands: green / amber / red  →  ledger accrual & payout hold         │
│  advertiser: attestation-coverage % + fraud-filter rate per campaign │
└─────────────────────────────────────────────────────────────────────┘
```

Two things the client **cannot** do, by construction:

1. **Forge history.** Events are hash-chained per device; a re-signed past requires the device key and a consistent chain. Server holds the head.
2. **Self-report money.** Billable clicks are server-attributed via the `/c/{code}` redirect ([04-impression-engine.md](04-impression-engine.md) §clicks); `click_hint` from the client is UX-only and never billed.

The client *can* lie about timing and liveness. That is what server-side scoring (§4) exists to catch, and why the honest advertiser claim is bounded (§7).

---

## 2. Device identity & signed/chained events

### 2.1 Identity

| Property | Value |
|---|---|
| Key type | Ed25519 (`ed25519-dalek` 2.x; pin 2.x — 3.0 still rc) |
| Generation | at install, in the daemon |
| Storage | OS keychain (Secret Service / macOS Keychain) |
| `device_id` | `base32(pubkey[..10])` |
| Account binding | `spnr login` (GitHub device flow / email magic link) binds `device_id → account_id` server-side |

> **Research correction:** the source specs called the device key "non-exportable." For the `keyring` crate that is **false** — it stores a readable secret blob. Downgrade the claim to **"OS-keychain-protected, encrypted-at-rest."** True non-exportable / Secure-Enclave keys need `security-framework` FFI + codesigning and are a separate hardware-bound hardening track. See [07-security-privacy.md](07-security-privacy.md) and [13-research-findings.md](13-research-findings.md) §F. The fraud model therefore must **not** assume key theft is impossible — a stolen key lets an attacker sign well-formed events, which is precisely why server-side behavioral scoring (§4), not key custody, is the real moat.

### 2.2 The per-device chain

Every device maintains an append-only chain. Three primitives bind each event to its predecessor and make replay/gap/fork **server-detectable**:

| Field | Type | Role |
|---|---|---|
| `ctr` | u64, persisted, never reused | strict monotonic counter — gaps and reuse are detectable |
| `id` | ULID (`ulid` 1.2.1, or `uuid` v7) | idempotency key + time-sortable; dedup on unique index |
| `prev` | `b3:<hex>` BLAKE3 (`blake3` 1.8.5) of previous event's canonical bytes | hash chain — forks/edits break continuity |

```
event[n]:  { v, id=ULID, ctr=n, prev=BLAKE3(canon(event[n-1])), t, type, session, creative, sig }
                                          │
                       canonical bytes (RFC 8785, serde_jcs) ──► Ed25519 sign
```

> **Research correction:** canonical-JSON-for-signing (RFC 8785) MUST be a **separate code path** from the `settings.json` round-trip. Signing uses `serde_json_canonicalizer`/`serde_jcs`; settings I/O uses `serde_json` with `preserve_order`. Two serializers, non-overlapping (see [13-research-findings.md](13-research-findings.md) §F). Wire details live in [03-protocol-SAP1.md](03-protocol-SAP1.md).

### 2.3 Server-side detection from the chain

Ingest runs these checks in order; any failure flags the device (it does **not** auto-ban — §5):

```
verify(sig, pubkey)              ── bad sig          → reject batch (possible key compromise / corruption)
ctr == stored_ctr_head + 1       ── ctr gap          → flag: gap   (missed/dropped events)
ctr <= stored_ctr_head           ── ctr replay/reuse → flag: replay (or honest retry → ULID dedup absorbs)
prev == stored_chain_head        ── chain mismatch   → flag: fork  (two heads = cloned/parallel signer)
ULID not seen                    ── duplicate ULID    → DROP idempotently (ON CONFLICT DO NOTHING)
within caps (§3, doc 04)         ── cap exceeded      → clamp + flag
```

| Anomaly | Chain symptom | Plausible cause | Action |
|---|---|---|---|
| **Replay** | `ctr ≤ head`, ULID already stored | retried batch (benign) **or** captured-and-resent | dedup; flag only if ULID *differs* on same `ctr` |
| **Gap** | `ctr` jumps forward | dropped queue (10 MB oldest-drop emits a `gap` marker — honest about loss) **or** selective suppression | tolerated; large/repeated gaps feed the score |
| **Fork** | two distinct events claim same `prev`/`ctr` | cloned device key on ≥2 machines | strong fraud signal; manual-review trigger |

> **Research correction:** do **not** trust hook-supplied timestamps. Stamp wall-clock + monotonic on **daemon receipt** — payload timestamp availability is inconsistent across Claude Code versions ([13-research-findings.md](13-research-findings.md) §A). The `t` field is the daemon's receipt time, not the host's. The server additionally compares `t` vs HTTP-receipt time and quarantines events outside a ±5-min window (clock-skew guard).

The three-layer idempotency that backs this is enforced as Postgres constraints, not application logic: **ULID PK**, `UNIQUE(device_id, ctr)`, `UNIQUE(ledger_ref)`, all with `ON CONFLICT DO NOTHING` (see [06-money-settlement.md](06-money-settlement.md)).

---

## 3. What the client attests (and what it cannot)

| Signal | Strength | Why |
|---|---|---|
| Headless `claude -p` earns nothing | **strong, confirmed** | non-interactive runs never invoke statusLine → no liveness gate → zero countable seconds |
| TTY-attached interactive session | medium | hook env + controlling-terminal cross-check; forgeable but raises cost |
| statusLine liveness gate | **coarse** (see below) | a human-visible TUI painted *recently*, not per-frame |
| hook-derived WAITING intervals | medium | wait-open/close from `UserPromptSubmit`/`Stop`; bracketing is not guaranteed clean |

> **Research correction (ADR-0002):** statusLine is **not** a per-frame render heartbeat. It fires on **message boundaries with a ~300 ms debounce**, not continuously during a wait, and its JSON carries **no frame-level timestamp** — so frame-granularity "device-signed render attestation" is impossible. statusLine also has known bugs: it can stop updating mid-session after the first response (issue #43826) and has had OSC-8-stripping regressions (v2.1.3 / v2.1.42 era). **Treat statusLine as a coarse liveness GATE, not a heartbeat.** It gates seconds inside hook-derived WAITING intervals (TUI painted within a debounce-widened window). The real moat is server-side timing-distribution scoring (§4). See [adr/0002-statusline-as-coarse-liveness-gate.md](adr/0002-statusline-as-coarse-liveness-gate.md) and the cadence open question in [12-risks-open-questions.md](12-risks-open-questions.md) (measure real cadence; widen the gate with a published constant).

Consequence for fraud design: because the on-machine gate is coarse and the device key is exportable (§2.1), **the client cannot be the source of truth.** Counting caps ([04-impression-engine.md](04-impression-engine.md): ≤60/interval, ≤600/hr, ≤4,000/day, one concurrent counting session/device) bound the damage; server scoring catches what survives the caps.

---

## 4. Server-side fraud features

Computed per device in ClickHouse, materialized every 5 minutes, compared against the device's cohort. No single feature decides anything; they feed a score ∈ [0,1].

| # | Feature | Honest signal | Fraud signature |
|---|---|---|---|
| 1 | **Impressions/hr vs cohort** | varies with real coding cadence | flat-max or far above cohort p99 |
| 2 | **Wait-interval length distribution (KS-distance)** | heavy-tailed (log-normal) — real agent turns vary wildly | uniform / periodic → high KS-distance from cohort reference |
| 3 | **Heartbeat-to-hook coherence** | statusLine liveness windows overlap hook WAITING intervals | heartbeats present with no matching host hooks (forged liveness) or vice-versa |
| 4 | **TTY attestation rate** | ~always interactive | low (headless leaking through) |
| 5 | **Chain gaps / forks** | rare, small, marker-explained | frequent gaps, any fork |
| 6 | **Click CTR outliers** | CTR within cohort band | CTR far above band (server-attributed clicks, §1) |
| 7 | **Device ↔ account graph** | 1 account ≈ few devices | one account fanned across many devices; many accounts sharing devices |
| 8 | **Payout-address reuse** | distinct destinations | one gift-card email / USDC address across many accounts (Sybil payout) |
| 9 | **IP-class entropy (click redirects)** | natural spread of `/c/{code}` origins | low entropy → single proxy/datacenter farm |

### 4.1 Feature 2 in detail — the timing distribution is the moat

Real agent wait intervals are **heavy-tailed**: a turn might wait 2 s or 90 s depending on the prompt, tool calls, and model load. A farm that scripts impressions tends toward **uniform or periodic** intervals. The Kolmogorov–Smirnov distance between a device's wait-interval CDF and the cohort reference CDF is the single most load-bearing feature, because:

- it does **not** depend on the coarse statusLine gate being precise;
- it is expensive for an attacker to fake *consistently* (they must reproduce a heavy-tailed distribution AND keep heartbeat/hook coherence AND a clean chain simultaneously);
- it degrades gracefully — a partially-faked timeline lands amber, not a false green.

```
cohort reference CDF (heavy-tailed) ─┐
device wait-interval CDF ────────────┼─► KS-distance D ─► feature[2]
                                     │   D small  → human-like
                                     │   D large  → uniform/periodic → suspicious
```

> **Research correction:** the source framing leaned on the statusLine "render heartbeat" as the primary viewability proof. Research weakened that to a coarse gate ([adr/0002](adr/0002-statusline-as-coarse-liveness-gate.md)); the fraud features above — especially the KS-distance on wait-interval distributions — are now the primary moat. Lean on server scoring.

---

## 5. Three score bands

Score ∈ [0,1] maps to three bands. The defining property: **higher bands never tell the device they were caught** — no fraud-oracle feedback, so attackers cannot train against the detector.

| Band | Accrual | Payout gate | Device-visible difference | Ban |
|---|---|---|---|---|
| **green** | full | 7-day rolling hold (applies to *all* accounts) | none | no |
| **amber** | discounted (published discount factor) | manual-review gate before redemption | **none** (no fraud-oracle feedback) | no |
| **red** | **shadow mode** — events accepted, nothing accrues | n/a | none | only on **manual confirmation** |

```
score ─┬─ low  ──► GREEN  : accrue full → ledger imp_earn → release T+7d
       ├─ mid  ──► AMBER  : accrue × discount → redemption blocked pending manual review
       └─ high ──► RED    : shadow — accepted, zero accrual; ban requires a human
```

Design rationale (all three from the spec, preserved):

- **No instant bans.** Auto-banning leaks the detector boundary and trains fraudsters. red is shadow mode; a human confirms before any ban.
- **The 7-day rolling hold is universal**, not a punishment — it gives the post-hoc cohort recomputation time to reclassify before money leaves.
- **amber is silent.** The device sees a normal balance; only redemption is gated. This is what denies the fraud oracle.
- Thresholds are **private**; the *methodology* is published (§6, [13-research-findings.md](13-research-findings.md)).

Band transitions are recomputed on each 5-min materialization and at redemption time; a device can move green→amber→red and back as cohort baselines and its own behavior shift.

---

## 6. Advertiser-facing attestation (the sellable transparency)

What advertisers actually buy is **transparency about quality**, per campaign:

| Metric | Definition | Why it sells |
|---|---|---|
| **Attestation coverage** | % of billed impressions backed by a valid signed, chained, gate-passed event | terminal inventory has never had a verifiable count before |
| **Fraud-filter rate** | % of candidate impressions filtered out (amber-discounted + red-shadowed) before billing | proves we undercount on purpose (invariant 3) |

```
candidate impressions
   │
   ├─ filtered (amber discount + red shadow)  ──► "fraud-filter rate"
   ▼
billed impressions
   │
   └─ backed by valid chained+gated events    ──► "attestation coverage"
```

- Both metrics are **per-campaign** in the advertiser portal; the scoring **methodology is published**, thresholds are not.
- This is the clean differentiator vs Kickbacks.ai, which self-reports impressions via local HTTP counting; spnr bills against device-signed, server-verified events. (Note: Kickbacks bootstraps its own inventory and has no real third-party advertisers yet — see [00-product-overview.md](00-product-overview.md) and [13-research-findings.md](13-research-findings.md) §H.)

---

## 7. Honesty boundary (non-negotiable)

> **Research correction:** the advertiser claim is **"attested + anomaly-filtered," never "viewability-grade."** Two facts force this: (1) the statusLine gate is coarse (~300 ms debounced, message-boundary, no frame timestamp — [adr/0002](adr/0002-statusline-as-coarse-liveness-gate.md)); (2) the device key is keychain-protected, not non-exportable (§2.1), so a determined attacker can sign well-formed events. We lean on **server-side timing-distribution scoring** as the real defense, not on the on-machine gate.

What we may say / must not say:

| OK to claim | Never claim |
|---|---|
| "Impressions are device-signed and hash-chained" | "IAB-viewability-grade" |
| "Headless / non-interactive runs earn nothing" | "Every impression == one human eyeball-second" |
| "X% attestation coverage, Y% fraud-filter rate, methodology published" | "Frame-level render attestation" |
| "We undercount on purpose (invariant 3)" | "Fraud-proof" / "unspoofable" |

Overstating attestation is the fastest way to lose advertiser trust permanently. Price the inventory to the honest claim. See [00-product-overview.md](00-product-overview.md) for positioning and [12-risks-open-questions.md](12-risks-open-questions.md) for the open cadence/threshold questions.

---

## 8. Validation — red-team simulations

The bands and features above are **conservative but unproven**. They are validated by the fraud red-team suite, specified in [08-testing-strategy.md](08-testing-strategy.md): scripted attackers run weekly against staging, and each **must land amber or red within published detection windows before any paid campaign launches.**

| Attacker | Targets feature(s) | Expected band |
|---|---|---|
| Headless `claude -p` loop | TTY rate (4), liveness gate | red |
| Heartbeat spammer (call `spnr-status` in a loop) | heartbeat-to-hook coherence (3) | amber→red |
| Replayer / chain editor | chain gaps/forks (5) | flagged → red |
| Uniform-cadence farm | KS-distance (2), impressions/hr (1) | amber→red |
| Multi-account Sybil | device↔account graph (7), payout-address reuse (8), IP entropy (9) | amber→red |

Acceptance criterion for launch: no attacker class achieves sustained **green** accrual. Detection windows and discount factors are published in [13-research-findings.md](13-research-findings.md); pass/fail gates are in [08-testing-strategy.md](08-testing-strategy.md) and [11-phases-roadmap.md](11-phases-roadmap.md).
