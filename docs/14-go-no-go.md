# spnr — Go / No-Go Readiness Assessment

> Purpose: the explicit "are we good to start implementing?" call, with conditions.
> Status: Draft v0.4 · June 12, 2026 · Based on [13-research-findings.md](13-research-findings.md) and [ADR-0006](adr/0006-crypto-native-agent-economy-launch-wedge.md).

## Verdict: **CONDITIONAL GO** for v0.1 — build it, with the reshapes locked in first

The architecture survives scrutiny. The Rust client + backend stack, the SAP/1 attestation protocol, the
double-entry ledger, and the x402/USDC rail are all real and buildable with mature, current tooling. Nothing
in the research is a *technical* dead end. The launch wedge is now **decided** ([ADR-0006](adr/0006-crypto-native-agent-economy-launch-wedge.md)):
crypto-native / agent-economy, with **USDC over x402 as the default developer payout** and fiat (gift cards /
UPI / local via Tremendous/Reloadly) as the off-ramp. That choice is sound and defensible — but it pulls real
regulatory and custody work onto the **pre-launch critical path**: a US money-services/MTL + crypto legal
opinion and the wallet/custody/escrow stack are now **v0.1 blockers, not later gates**. They are the single
biggest cost of choosing the crypto-native wedge. Lock these conditions in before (or as) you start, and v0.1
is a green light.

```
        BUILDABLE NOW                RESHAPE / DECIDED FIRST          GATE LATER (not v0.1)
  ┌────────────────────────┐  ┌────────────────────────┐   ┌──────────────────────────────┐
  │ Rust client + daemon   │  │ Wedge DECIDED: crypto-  │   │ Agent-buyer x402 API (v1.0)   │
  │ SAP/1 protocol         │  │   native; USDC default  │   │ Phase 3 browser ext (2 gates) │
  │ pgledger double-entry  │  │ USDC payout + MSB/MTL   │   │ Targeting segments (v0.3)     │
  │ axum/Redis/ClickHouse  │  │   legal opinion +       │   │                               │
  │ x402/USDC (batched)    │  │   wallet/custody = v0.1 │   │                               │
  │                        │  │ statusline = coarse gate│   │                               │
  │                        │  │ Register domains/handles│   │                               │
  │                        │  │   (.sh/.co/.dev + GH)   │   │                               │
  └────────────────────────┘  └────────────────────────┘   └──────────────────────────────┘
```

---

## ✅ Confirmed buildable (green)

- **Host integration:** `spinnerVerbs` and hooks are real on Claude Code 2.1.175; plugins can bootstrap a
  daemon. The read-at-startup + session-attribution design is robust.
- **Client stack:** every required Rust crate exists and is current (versions in [09-repo-build-layout.md](09-repo-build-layout.md)).
- **Backend stack:** axum/sqlx/redis/ClickHouse are mature; `pgr0ss/pgledger` is a near-exact double-entry
  ledger to port; scale targets have ~200× headroom.
- **Payments rail:** x402 is a real LF-governed standard with production Rust crates; USDC-on-Base settlement
  is cheap and fast.
- **Anti-fraud foundation:** headless `claude -p` genuinely never invokes statusline → headless earns nothing.
  Server-side signed/chained idempotent events are sound.

## 🔧 Reshape / decided before build (the items that shape the product)

### 1. Wedge: **DECIDED — crypto-native; USDC default; fiat off-ramp** — [ADR-0006](adr/0006-crypto-native-agent-economy-launch-wedge.md)
The launch wedge is no longer an open question. spnr is positioned as the open, crypto-native, agent-economy
ad network: **settlement is x402/USDC-native (Base) and the default developer payout is USDC over x402** to a
user-supplied wallet, with the agent-buyer surface ("agents buying human attention") foregrounded as the
story. **Fiat is the off-ramp, not the default** — gift cards / UPI / local payouts via Tremendous/Reloadly
([ADR-0001](adr/0001-payout-default-gift-cards-not-api-credits.md)) stay available for developers who prefer
fiat or are in tax-sensitive jurisdictions (notably India). The "no API-credit-code resale" rule from
ADR-0001 still stands. **Hard consequence:** the **US money-services/MTL + crypto legal opinion** and the
**wallet/custody/escrow + key-management stack** are now **v0.1 blockers** (see conditions below) — this is
the biggest cost of choosing the crypto-native wedge, and it is designed for, not discovered later.

### 2. statusline = coarse liveness gate, **not** a per-frame heartbeat — [ADR-0002](adr/0002-statusline-as-coarse-liveness-gate.md)
statusline fires on message boundaries with a ~300 ms debounce and has known bugs — it is not per-frame and
carries no frame timestamp. Treat it as a coarse gate over hook-derived wait intervals and **lean on
server-side fraud scoring** as the real moat. Advertiser claim = "attested + anomaly-filtered," never
"viewability-grade." (Undercount-safe; no revenue inflation.)

### 3. Register the names/domains — [ADR-0005](adr/0005-naming-and-domains.md)
**`spnr.sh` and `spnr.co` are currently UNREGISTERED** (the spec assumed they were owned). `spnr.dev` is
registered by an unknown party. GitHub `spnr` is a taken dormant *user* account. crates.io `spnr` and npm
`@spnr` are free. → **Register `spnr.sh` + `spnr.co` today, confirm/secure `spnr.dev`, reserve crates.io
`spnr` + npm `@spnr`, and pick a GitHub org handle.** This is the cheapest, most time-sensitive item on the list.

## ⛔ Pre-launch conditions (v0.1 blockers — the cost of the crypto-native wedge)

These were "gate later" while the wedge was open. With USDC chosen as the default payout
([ADR-0006](adr/0006-crypto-native-agent-economy-launch-wedge.md)) they move **onto the pre-launch critical
path** — do not ship a real USDC payout until both the legal opinion and the custody stack clear.

| Item | Pre-launch condition |
|---|---|
| **USDC payout rail (default)** | A real **US money-services/MTL + crypto legal opinion** — paying out USDC likely makes spnr a money transmitter / MSB unless an exemption applies ([13-research-findings.md](13-research-findings.md) §I, [12-risks-open-questions.md](12-risks-open-questions.md)). KYC/AML + velocity limits designed into the redemption flow. India tax copy by a CA; in-flow VDA/TDS disclosure (s.115BBH 30% + s.194S 1% TDS). |
| **Wallet / custody / escrow + key management** | Hot (MPC/HSM, spend-capped) + cold reserve, published segregated escrow address, EIP-3009 nonce tracking, depeg breaker — all before the first real USDC payout. Custody choice (self-managed vs Coinbase CDP managed wallets) decided. |

## ⛔ Gate behind explicit checkpoints (still NOT in v0.1)

| Item | Gate |
|---|---|
| Published "earn $X" / "get paid to wait" claims | FTC earnings-claim substantiation + "results not typical" qualifiers; clear sponsored disclosure |
| Agent-buyer x402 API (full `POST /v1/bids → 402`, v1.0) | spnr's own self-contained gate live: x402 payment-as-gate (real USDC upfront) + the same creative lint humans pass + a human-review queue for first-time buyers + on-platform buyer reputation. *Note: the agent-buyer surface is foregrounded as the launch story from v0.1; the full bid API matures over the roadmap.* |
| Phase 3 browser extension | Dual gate: (1) paying advertisers + clean fraud record on CLI; (2) tolerable host-ToS legal read |

## 🔒 Hard constraints (bake into the architecture from commit 1) — [ADR-0004](adr/0004-platform-risk-adapter-abstraction.md)

1. Use the **unmodified official** Claude Code binary. Never export OAuth/subscription tokens. Never route
   model requests. **Never suppress or spoof host telemetry/heartbeats** (that was the trigger in Anthropic's
   prior third-party crackdown).
2. Everything on the user's machine is open source + reproducible; the daemon never reads work product
   (content firewall, CI-enforced — [07-security-privacy.md](07-security-privacy.md)).
3. The editor-safety suite (settings never left sponsored without a live daemon) **blocks release** —
   [08-testing-strategy.md](08-testing-strategy.md).
4. Isolate platform risk behind `HostAdapter`; a `spinnerVerbs` removal degrades to statusline-only, not an
   outage.

## ⚠️ Residual existential risk (eyes open)

Platform risk is **narrower than first feared but still real**: `spinnerVerbs` is possibly undocumented and
removable in a single Anthropic release, and Anthropic could kill the category discretionarily for brand
reasons (they market Claude as ad-free). **The single highest-signal datapoint is Anthropic's first public
reaction to Kickbacks.ai** (1 day old). Watch it; keep burn low; build the attestation + x402 pieces as
reusable libraries so they survive even if the spinner inventory disappears.

---

## Decisions needed from you before I start coding

The launch-wedge question is **resolved** ([ADR-0006](adr/0006-crypto-native-agent-economy-launch-wedge.md): crypto-native, USDC default, fiat off-ramp). The open items are now the ones the crypto-native wedge puts on the critical path:

1. **Legal-opinion timeline + counsel:** who runs the US money-services/MTL + crypto legal opinion, and on
   what timeline? It is now a v0.1 blocker for the default USDC payout — the sooner it starts, the less it
   gates the build.
2. **Custody choice:** self-managed (MPC/HSM hot + cold reserve, our own key handling) vs **Coinbase CDP
   managed wallets** (less key-handling risk). This decides the wallet/custody/escrow build.
3. **Wallet-onboarding UX + India fiat-off-ramp default:** how non-crypto developers onboard a wallet, and
   making "no wallet? get paid in a gift card / UPI instead" a first-class, one-tap choice — especially the
   default off-ramp for India given VDA/TDS friction.
4. **Agent-buyer gate (v1.0):** confirm spnr's own self-contained gate is the plan — x402 payment-as-gate
   (real USDC upfront) + the same creative lint humans pass + a human-review queue for first-time buyers +
   on-platform buyer reputation from payment + creative history. MoltNet is an optional external reputation
   provider we can plug in later if the open agent market gets spammy — not a launch dependency and not on
   any critical path.
5. **Scope of "start implementing":** v0.1 critical path per [10-implementation-plan.md](10-implementation-plan.md)
   (workspace → protocol → hot-path binaries → daemon settings-merge + editor-safety → impression engine →
   backend ingest/auction/ledger/redirector → installer → USDC payout + fiat off-ramp), or a narrower first
   slice (e.g., just the editor-safe spinner-injection + impression engine on a fresh machine)?

**Recommendation:** start the v0.1 build **and the remaining live spikes in parallel with immediately kicking
off the MSB/MTL legal opinion and custody setup** — both are now on the pre-launch critical path, so the
sooner they start the less they gate launch. **Do not ship a real USDC payout until both the legal opinion and
the custody stack clear.** **Update:** the four de-risking spikes (S1–S4) have now been run against the live
Claude Code 2.1.175 binary and docs — **all four pass** (see [15-spike-results.md](15-spike-results.md)).
Headline: `spinnerVerbs` schema confirmed from the binary; hook hot-path floor ~0.6 ms with `http`/`async`
hook options; and the statusline heartbeat is **rescued** by `statusLine.refreshInterval: 1` (~1 Hz tick). The
only items left are three live-session measurements (hook overhead under load, statusline cadence under heavy
streaming, OSC 8 through tmux) that run during the first build slice, not before it.
