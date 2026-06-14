# spnr — Phases & Roadmap

> Milestone scope, acceptance criteria, and explicit go/no-go gates for v0.1 → v1.0 plus the conditional Phase 3 browser surface.
> Status: Draft v0.3 · June 12, 2026

This document is the **gate ledger**: each milestone has a fixed scope, a binary acceptance checklist, and a single go/no-go decision that must clear before the next milestone starts. It complements the sequenced engineering build in [10-implementation-plan.md](10-implementation-plan.md); where this doc says *what must be true to ship*, the implementation plan says *in what order to build it*.

> **Wedge alignment ([ADR-0006](adr/0006-crypto-native-agent-economy-launch-wedge.md)):** spnr launches as the open, **crypto-native, agent-economy** ad network for terminal wait-states. The **default developer payout is USDC over x402 (Base)**, with gift cards / UPI / local payouts via Tremendous as the **fiat off-ramp** (not the default). The agent-buyer x402 surface — autonomous agents buying human attention — is the foregrounded story. As a hard consequence, the **US money-services/MTL + crypto legal opinion and wallet/custody now sit on the v0.1 pre-launch critical path** (pulled forward from v0.3). USDC raises real MSB/MTL exposure and real India VDA/TDS friction — those frictions are surfaced, not hidden, throughout this doc.

Cross-references: [00-product-overview.md](00-product-overview.md) · [01-architecture.md](01-architecture.md) · [03-protocol-SAP1.md](03-protocol-SAP1.md) · [04-impression-engine.md](04-impression-engine.md) · [05-fraud-attestation.md](05-fraud-attestation.md) · [06-money-settlement.md](06-money-settlement.md) · [08-testing-strategy.md](08-testing-strategy.md) · [12-risks-open-questions.md](12-risks-open-questions.md) · [13-research-findings.md](13-research-findings.md) · [14-go-no-go.md](14-go-no-go.md).

---

## 0. Timing window & framing

The category is roughly 48 hours old (Kickbacks.ai launched June 11, 2026) and riding a hype wave. The realistic window to ship a credible alternative is **2–3 weeks** before the space is crowded or interest decays.

> **Research correction:** The "Kickbacks ~614K launch-day views, overwhelmingly positive" framing from the source spec is softened. It was a single viral X launch post (cited 556K–614K, ~3.6M cumulative per secondary coverage), and sentiment measured ~74% positive / ~26% negative across ~336 comments — not "overwhelmingly positive." Plan against real demand uncertainty, not a hype number. See [13-research-findings.md](13-research-findings.md) §H.

Roadmap constraints that shape every gate below:

| Constraint | Source | Effect on gates |
|---|---|---|
| `spinnerVerbs` is fragile / possibly-undocumented; Anthropic can remove it in one release | research §A | every milestone must keep the `HostAdapter` abstraction + statusline-only fallback viable (invariant: ship behind the adapter) |
| Platform risk is "unadjudicated gray area," not "likely shutdown" — but discretionary brand/PR shutdown is real | research §B | watch Anthropic's first reaction to Kickbacks.ai as the highest-signal datapoint; keep burn low |
| **Default payout wedge is USDC over x402 (Base)** ([ADR-0006](adr/0006-crypto-native-agent-economy-launch-wedge.md)); gift cards via a battle-tested aggregator (Tremendous) are the **fiat off-ramp**, NOT resold API credit codes | research §C/§I, ADR-0001, ADR-0006 | v0.1 gate redeems **USDC to a test wallet** as the default **and** a **gift card** via the off-ramp — never an "API credit code" |
| **USDC rail raises federal MSB + state MTL exposure** | research §I, ADR-0006 | because USDC is now the **default v0.1 payout**, the written money-services/MTL + crypto legal opinion **and** wallet/custody are **v0.1 go-live gates** (pulled forward from v0.3), not later gates |
| **The public agent-buyer gate is self-contained — no external dependency** | this doc | the v1.0 public agent-buyer gate closes on spnr's own native gate being live (x402 payment-as-gate + creative lint + human-review queue for first-time buyers + spnr's own on-platform buyer reputation); see §5.2. Settlement/protocol is x402-native from v0.1 regardless |

---

## 1. Milestone map

```
 week 1        weeks 2–3         month 2            month 3            month 4+
┌────────┐   ┌──────────┐     ┌──────────┐      ┌──────────┐      ┌──────────────┐
│  v0.1  │──▶│   v0.2   │────▶│   v0.3   │─────▶│   v1.0   │─ ─ ─▶│  Phase 3      │
│  MVP   │   │ protocol │     │targeting │      │ agent-   │ cond.│ browser wait- │
│ terminal│  │ + plugin │     │ + VS Code│      │ buyer    │      │ state ext.    │
│ USDC +  │   │ + audit  │     │ wrapper  │      │ public   │      │ (DUAL gate)   │
│ off-ramp│   │ + SAP/1  │     │ + repro  │      │ API +    │      │               │
│ (x402)  │   │          │     │ builds   │      │ self-host│      │               │
└────────┘   └──────────┘     └──────────┘      └──────────┘      └──────────────┘
   GATE 1        GATE 2           GATE 3            GATE 4           GATE 3a + 3b
```

Each gate is **binary and blocking**: if any acceptance criterion is unmet, the milestone does not ship and the next does not start. Gate decisions are recorded in [14-go-no-go.md](14-go-no-go.md).

---

## 2. v0.1 — MVP (week 1)

**Theme:** prove the full money loop end-to-end on a terminal as a **crypto-native** network — **default payout in USDC over x402**, with the fiat off-ramp available — and with the editor-safety guarantee intact. The agent-economy identity is real from day one because settlement is x402-native, not aspirational.

### 2.1 Scope

- Rust daemon `spnrd` + hot-path binaries `spnr-hook`, `spnr-status`, user CLI `spnr` (one workspace; see [09-repo-build-layout.md](09-repo-build-layout.md)).
- `curl -fsSL https://get.spnr.sh | sh` installer (Path A); BLAKE3 + minisign verification.
- Claude Code **CLI adapter** only (`claude_code_cli`): hooks + JSONL timing reconciliation.
- Spinner injection via `spinnerVerbs` (read-at-startup, rotate-on-SessionStart, one creative per session).
- Statusline surface: earnings ticker + OSC 8 click link to `https://spnr.sh/c/{code}`.
- GitHub device-flow / email magic-link auth, fully in-terminal.
- Hosted single-slot auction with **house-ad seeded inventory, labeled as house ads**.
- **x402-native settlement from day one** — balances stay USD-denominated in the ledger; **USDC over x402 (Base) is the default settlement of that balance**, paid to a user-supplied wallet, minimum $5. Payouts **batch** (hourly / threshold ≥ $1–$5); per-impression on-chain settlement is impossible.
- **Fiat off-ramp live alongside USDC: gift-card / local-payout redemption via Tremendous (sandbox→production), minimum $5** — surfaced as a first-class, one-tap "no wallet? get paid in a gift card / UPI instead" choice.
- **Wallet / custody live on the v0.1 critical path:** spend-capped hot wallet (MPC/HSM, e.g. Coinbase CDP managed wallets) + cold reserve, published segregated escrow address, EIP-3009 nonce tracking, depeg breaker — all required before the first real USDC payout.

> **Research correction:** The source spec listed "API credits (default)" as the day-one redemption tier. This is refuted — neither Anthropic nor OpenAI sells resellable prepaid API-credit codes, and OpenAI's Service Credit Terms explicitly prohibit transfer/sale/gift of credits. Per [ADR-0006](adr/0006-crypto-native-agent-economy-launch-wedge.md) the v0.1 **default** is **USDC over x402**, with **gift-card / local-payout redemption via Tremendous** retained as the **fiat off-ramp**. The "no API-credit-code resale" rule (ADR-0001) still stands. See [06-money-settlement.md](06-money-settlement.md), ADR-0001, and ADR-0006.

> **Intellectual honesty (do not hide):** USDC as the default payout makes spnr a likely money transmitter / MSB and exposes it to state MTL ([13-research-findings.md](13-research-findings.md) §I), so the legal opinion + custody are v0.1 blockers (A9 below). It is also **heavier for Indian developers** — USDC receipt is taxed as income on receipt and 30% (s.115BBH) + 1% TDS (s.194S) on transfer — which is why the fiat off-ramp (UPI / Amazon-India / local) is retained and surfaced, and why in-flow VDA/TDS disclosure is mandatory.

### 2.2 Acceptance criteria (binary)

| # | Criterion | Measurement | Invariant |
|---|---|---|---|
| A1 | Fresh-machine flow: install → login → sponsored spinner appears → impressions visible in `spnr status` → redeem **$5 as USDC over x402 to a test wallet** (default) **and** via the **fiat off-ramp ($5 gift card / UPI via Tremendous)**, each completing in **< 2 minutes** | timed run on a clean VM (linux x86_64) + clean macOS arm64, both rails exercised | — |
| A2 | **Editor-safety suite green** | property tests over settings merge (inject→restore→byte-equivalent) + crash-injection (`kill -9` at random points → config never sponsored > 60 s); blocks release | inv. 1, 6 |
| A3 | **Killswitch demonstrated** | signed killswitch flips creative payload to null; clients revert to stock verbs ≤ 60 s, observed live | inv. 1, 6 |
| A4 | **House ads labeled as house ads** | every seeded creative carries a visible house-ad marker in `spnr status` and in advertiser-facing stats | FTC disclosure (research §I) |
| A5 | Headless `claude -p` earns nothing | run headless loop → assert zero countable seconds (no statusline render → no liveness gate) | inv. 3, 4 |
| A6 | Content firewall holds | egress-canary test: secrets in fixture transcripts never appear in any outbound byte | inv. 2 |
| A7 | Project-level `spinnerVerbs` override ⇒ no impressions served on that device | adapter detects project `.claude/settings.json` and serves nothing | research §A |
| A8 | `spnr pause` / `spnr uninstall` / daemon crash all restore the snapshot | stale-lock check; any spnr binary can restore (idempotent) | inv. 1, 6 |
| A9 | **MSB/MTL + crypto legal opinion on file AND wallet/custody signed off** | a US money-services/MTL + crypto legal opinion is written and on file, **and** the spend-capped hot/cold custody, segregated escrow address, EIP-3009 nonce tracking, and depeg breaker are reviewed and signed off — **before** the first real USDC payout. India VDA/TDS notice surfaced in-flow | research §I, ADR-0006 |

> **Research correction:** The "render heartbeat = one human-visible paint per frame" framing (source tech-spec §2.2) is too strong. statusLine fires on **message boundaries with a ~300 ms debounce**, not per frame, and has no frame-level timestamp. A5's anti-fraud guarantee survives (headless `claude -p` genuinely never invokes statusLine), but treat statusLine as a **coarse liveness gate**, not a per-frame attestation. See ADR-0002 and [04-impression-engine.md](04-impression-engine.md).

> **Research correction:** x402/USDC settlement is real and production-ready (Linux Foundation x402 Foundation, formed April 2, 2026; Coinbase + Cloudflare + Stripe origin). But **facilitators do not custody funds** — escrow and key custody are spnr's burden (hence A9) — and per-impression on-chain settlement is economically impossible (Base tx ~$0.002–$0.02 vs impression value ~$0.000001–$0.00001), so payouts **must batch** (hourly / threshold ≥ $1–$5). Depend on the component crates `x402-axum` / `x402-reqwest` (v1.5.6), not the stale umbrella crate. See [06-money-settlement.md](06-money-settlement.md), ADR-0003, and research §D, §I.

### 2.3 Go/no-go gate (GATE 1)

**GO if** A1–A9 all pass **AND** the editor-safety suite is wired into CI as a release-blocking gate **AND** the **MSB/MTL + crypto legal opinion is on file and wallet/custody is signed off (A9)** **AND** Tremendous production access is approved for the fiat off-ramp (or a documented sandbox-only soft-launch decision is recorded in [14-go-no-go.md](14-go-no-go.md)).

**NO-GO triggers (any one blocks launch):**
- **No written MSB/MTL + crypto legal opinion, or wallet/custody not signed off (A9 fails)** → the default USDC rail cannot go live; do not launch the crypto-native wedge until it clears.
- Editor-safety suite cannot be made deterministically green (A2 fails).
- Fresh-machine flow exceeds 2 minutes and cannot be reduced (A1 fails).
- The default USDC-over-x402 payout cannot fund a real $5 redemption to a test wallet under the custody controls.
- Tremendous (or a redundant rail — Tango Card / Reloadly) cannot fund a real $5 gift card for the fiat off-ramp.
- `spinnerVerbs` is observed to be removed or gated in the locally-tested Claude Code version (escalate to the adapter-fallback decision in ADR-0004).

---

## 3. v0.2 — Protocol & distribution (weeks 2–3)

**Theme:** make it an open protocol, add the second host, and harden the fraud story enough for real (non-house) advertisers.

### 3.1 Scope

- **Claude Code plugin install path** (Path B): one plugin registers hooks, contributes the statusline command, and bootstraps the daemon **on first SessionStart** (not at install time — no arbitrary install-time exec).
- **Codex CLI adapter** (`codex_cli`).
- `spnr audit` — dump every event sent in the last N days, human-readable.
- **SAP/1 RFC published** at spnr.dev (see [03-protocol-SAP1.md](03-protocol-SAP1.md)).
- Fraud scoring v1 (server-side; green/amber/red bands — see [05-fraud-attestation.md](05-fraud-attestation.md)).
- **Advertiser self-serve portal with card funding** (Stripe where available).
- **TypeScript portal/auction API (`server-ts/`)** — the advertiser portal + auction + payments/fulfillment API land in TypeScript and **call the Rust verifier rather than reimplementing it** (one crypto codepath); the v0.1 Rust thin-verifier/ledger/redirector are not rewritten. See [ADR-0007](adr/0007-language-split-rust-client-ts-backend.md).

### 3.2 Acceptance criteria (binary)

| # | Criterion | Measurement |
|---|---|---|
| B1 | Plugin install path works | install plugin in Claude Code → daemon bootstraps on first SessionStart → impressions accrue; host startup never blocked if daemon slow/absent |
| B2 | Codex adapter parity | Codex CLI session produces attested impressions through the same `HostAdapter` trait |
| B3 | `spnr audit` complete | dumps the raw outbound queue; output is the privacy policy (matches published SAP/1 schema exactly) |
| B4 | SAP/1 RFC published | versioned RFC live at spnr.dev; client/server share `spnr-proto` canonical encoding + Ed25519 signing |
| B5 | **Fraud sims passing** | scripted attackers (headless loops, heartbeat spammers, replayers, multi-account farms) each land **amber/red within published detection windows** on staging |
| B6 | Advertiser self-serve with card funding | a real external advertiser can create a campaign, submit a creative (auto-linted), fund by card, and serve |
| B7 | Hook latency benchmarked | end-to-end `spnr-hook` latency empirically measured; if it adds perceptible host latency, default-off / opt-in decision recorded |

> **Research correction:** Hooks are real but `Stop` is **not guaranteed to fire once per `UserPromptSubmit`** (interrupts, API errors, blocking hooks can drop it), hook timestamps are unreliable (stamp on daemon receipt), and fire-and-forget is **not free** (~200 ms observed overhead in some setups). B7 makes the latency benchmark a gate criterion rather than an assumption. See [04-impression-engine.md](04-impression-engine.md) and research §A.

### 3.3 Go/no-go gate (GATE 2)

**GO if** B1–B7 pass **AND** at least one real third-party advertiser has funded a live campaign **AND** the fraud-sim detection windows are published.

**NO-GO triggers:**
- Plugin bootstrap blocks or degrades host startup (violates invariant 1) — fall back to curl-only distribution.
- Marketplace submission is rejected for ad-monetization policy — fall back to a community marketplace (do not block the milestone on official approval).
- Any fraud sim fails to be detected within its published window (B5) — paid (non-house) campaigns stay closed until it does.

---

## 4. v0.3 — Targeting & IDE parity (month 2)

**Theme:** add targeting slots, ship reproducible builds, and reach IDE parity. (The USDC payout rail and its legal/custody gates moved **forward to v0.1** per [ADR-0006](adr/0006-crypto-native-agent-economy-launch-wedge.md); this milestone hardens targeting and surfaces, not the money rail.)

### 4.1 Scope

- Targeting slots: `geo` / `adapter` (and `os`) as separately auctioned segments. Geo from edge IP at serve time; never stored on device. **No content/code-based targeting, ever** (invariant 2).
- **Reproducible builds** with published BLAKE3 hashes (invariant 5).
- **VS Code thin wrapper** (`claude_code_ide` / `vscode` adapter) reusing the daemon socket.
- **USDC rail hardening** (not first enablement — that shipped in v0.1): broaden caps/velocity tuning and KYC/AML thresholds as volume grows, on top of the legal opinion + custody already on file.

### 4.2 Acceptance criteria (binary)

| # | Criterion | Measurement |
|---|---|---|
| C1 | Targeting slots auctioned | geo/adapter segments serve as distinct slots; no device-side targeting state |
| C2 | Reproducible builds | independent rebuild reproduces the published hashes; CI size-check gate green (`spnr-hook`/`spnr-status` < 1 MB stripped) |
| C3 | VS Code wrapper parity | IDE wrapper produces attested impressions through the same socket API; one brain, many surfaces |
| C4 | **USDC caps/velocity tuned for growth** | per-payout + daily caps and KYC/AML thresholds re-tuned for higher volume; per-user daily redemption kept < $2,000 absent enhanced KYC; depeg breaker still live (dual-source peg: Chainlink USDC/USD on Base + DEX TWAP; pause on > 50 bps deviation with published resume criteria) |

> **Research correction:** x402/USDC settlement is real and production-ready (Linux Foundation x402 Foundation, formed April 2, 2026; Coinbase + Cloudflare + Stripe origin). But **facilitators do not custody funds** — escrow and key custody are spnr's burden — and per-impression on-chain settlement is economically impossible (Base tx ~$0.002–$0.02 vs impression value ~$0.000001–$0.00001), so payouts **must batch** (hourly / threshold ≥ $1–$5). Depend on the component crates `x402-axum` / `x402-reqwest` (v1.5.6), not the stale umbrella crate. See [06-money-settlement.md](06-money-settlement.md), ADR-0003, ADR-0006, and research §D, §I.

### 4.3 Go/no-go gate (GATE 3)

**GO if** C1–C4 pass.

**NO-GO triggers:**
- Reproducible builds cannot reproduce published hashes (C2) → blocks the whole milestone (invariant 5 is load-bearing for trust).
- Depeg breaker regresses or USDC caps cannot be safely tuned for higher volume (C4) → pause new-volume changes; the existing v0.1 USDC rail and caps stay in force.

---

## 5. v1.0 — Public agent-buyer API & self-host (month 3)

**Theme:** the press-worthy novel beat (agents buying human attention) reaches **full public GA**, plus the open-protocol promise (self-host + governance). Settlement and protocol were x402-native from v0.1, so the agent-economy story is already true; v1.0 opens the public `POST /v1/bids → 402` surface behind spnr's own self-contained buyer gate.

### 5.1 Scope

- **Public x402 agent-buyer API** (`POST /v1/bids` → 402 challenge → USDC on Base → enters the same auction queue), **behind the native self-contained gate** (§5.2). GAs at v1.0 once that gate is live; the underlying x402 settlement already shipped in v0.1.
- **Self-host kit:** server crates + docker-compose for private networks.
- **Protocol governance doc** (how SAP/1 evolves; who can change the wire schema).

### 5.2 The native agent-buyer gate (self-contained — no external dependency)

> **The agent-buyer gate is self-contained — spnr already has it.** Opening the public bid API to autonomous agents does **not** depend on any external reputation provider. Four native controls keep slop out of the auction: **(a) payment is the gate** — x402 requires real USDC upfront, so spam costs money; **(b) the same creative lint** every human advertiser already passes; **(c) a human-review queue for first-time buyers** (no open self-serve until a buyer clears it); and **(d) spnr's own on-platform buyer reputation**, built from each buyer's payment + creative history. **GATE 4 closes when this native gate is live — it does not block on anything external.** Track this in [12-risks-open-questions.md](12-risks-open-questions.md). (Note: x402-native settlement is live from v0.1 regardless.)
>
> **Optional future integration:** MoltNet is an optional external reputation provider we can plug in later if the open agent market gets spammy — not a launch dependency.

### 5.3 Acceptance criteria (binary)

| # | Criterion | Measurement |
|---|---|---|
| D1 | Public agent-buyer API live | `POST /v1/bids` returns 402; agent pays USDC; bid enters the queue; creative passes the same lint |
| D2 | **Native agent-buyer gate enforced** | buying requires real USDC upfront (payment is the gate); the creative passes the same lint humans pass; first-time buyers hit a human-review queue; on-platform buyer reputation accrues from payment + creative history (§5.2) |
| D3 | Self-host kit works | a third party stands up the network from server crates + docker-compose and serves an impression end-to-end |
| D4 | Protocol governance published | governance doc defines SAP/1 change process; wire schema is closed-world (adding a field requires a spec change) |
| D5 | Anti-self-dealing holds at scale | an advertiser account cannot win impressions served to its own devices (server join; matches unpaid/unbilled) |

### 5.4 Go/no-go gate (GATE 4)

**GO if** D1, D3, D4, D5 pass **AND** D2 is satisfied by the native self-contained gate being live (§5.2).

**NO-GO triggers:**
- Agent self-serve opened **without** the native gate live (would let slop into the auction) — keep first-time buyers in the human-review queue instead.
- Self-host kit cannot be stood up by an external party (D3) — the open-protocol promise is not credible yet; defer the governance/marketing beat.

---

## 6. Phase 3 — Browser wait-state extension (month 4+, CONDITIONAL)

**Theme:** extend the same account/ledger/redemption to consumer AI chat wait-states — **only if** the CLI business has earned the right and legal review is tolerable. This is a **dual go/no-go gate** and is **conditional**: if either gate fails, the extension stays shelved and the CLI business stands alone.

### 6.1 Non-negotiable design constraints

These are hard constraints, not preferences. Violating any one kills the whole network's standing with host platforms.

| Constraint | Rule |
|---|---|
| **No DOM injection** | Never inject into the host page's DOM or mimic its UI. Ads render **exclusively** in extension-owned surfaces (side panel, toolbar popup, or a clearly spnr-branded bar). |
| **Only while a response is pending** | Surfaces show only during a wait/streaming state, never persistently. |
| **No host-UI mimicry** | Nothing that pattern-matches to adware in Chrome Web Store review or to users. The CLI's `spinnerVerbs` is sanctioned host configuration; DOM injection into someone else's web app is not. |
| **Respect host positioning** | Anthropic explicitly markets its products as ad-free spaces (Feb 2026, Super Bowl LX commitment: "no sponsored links," "no third-party product placements"). The extension must not antagonize that. |

> **Research correction:** This constraint is reinforced, not relaxed, by the platform-risk research. Anthropic's Jan–Apr 2026 crackdown targeted token-export / client-spoofing harnesses (which spnr is not), so the CLI surface is a gray area rather than a likely-shutdown — **but** a visible third-party ad injected into claude.ai/chatgpt.com would be a discretionary brand/PR shutdown trigger. The no-DOM-injection line is what keeps the whole network alive. See ADR-0004 and research §B.

### 6.2 The upside that justifies the risk

A real browser DOM means **viewability events the terminal cannot produce** (IntersectionObserver, focus/visibility) — browser impressions can be measured more directly than terminal impressions, which remain **attested, not viewability-grade**. The consumer audience is ~100× the CLI's. Same account, same ledger, same USDC-default / fiat-off-ramp redemption.

### 6.3 Dual go/no-go gate (GATE 3a + GATE 3b — BOTH must pass)

```
        ┌─────────────────────────────┐     ┌─────────────────────────────┐
        │ GATE 3a — Business earned    │ AND │ GATE 3b — Legal tolerable    │
        │ • CLI network has PAYING      │     │ • host-platform ToS review   │
        │   (non-house) advertisers     │     │   comes back tolerable        │
        │ • CLI fraud record is CLEAN   │     │ • no DOM-injection plan       │
        │   (no unresolved red bands)   │     │   confirmed by counsel        │
        └──────────────┬──────────────┘     └──────────────┬──────────────┘
                       └───────────────┬───────────────────┘
                                       ▼
                          BOTH pass → build extension
                          EITHER fails → stays shelved
```

| Gate | Criterion | Decision |
|---|---|---|
| **3a (business)** | CLI network has paying third-party advertisers **and** a clean fraud record | if not met → **shelve** (the CLI business stands alone) |
| **3b (legal)** | Legal review of host-platform ToS (claude.ai / chatgpt.com / gemini.google.com) comes back **tolerable**, with the no-DOM-injection constraint confirmed | if not met → **shelve** |

**Phase 3 is entered ONLY if 3a AND 3b both pass.** There is no partial entry. If either fails, the CLI business continues unaffected; the extension is reconsidered when conditions change.

---

## 7. Gate summary

| Gate | Milestone | Hard precondition (non-waivable) | Primary NO-GO trigger |
|---|---|---|---|
| GATE 1 | v0.1 MVP | editor-safety suite green; **MSB/MTL + crypto legal opinion on file and wallet/custody signed off**; $5 redeems as USDC over x402 to a test wallet (default) **and** $5 gift card via the Tremendous fiat off-ramp | editor-safety not green, no legal opinion / custody not signed off, or fresh-flow > 2 min |
| GATE 2 | v0.2 | fraud sims detected within published windows; one real advertiser funded | any fraud sim undetected → paid campaigns stay closed |
| GATE 3 | v0.3 | reproducible builds reproduce published hashes | hashes not reproducible → milestone blocked |
| GATE 4 | v1.0 | the native self-contained agent-buyer gate is live (x402 payment-as-gate + same creative lint + human-review queue for first-time buyers + spnr's own on-platform buyer reputation) | agent self-serve opened without the native gate live |
| GATE 3a + 3b | Phase 3 | **BOTH** business-earned AND legal-tolerable | either fails → extension shelved |

All gate decisions and their evidence are recorded in [14-go-no-go.md](14-go-no-go.md). Open questions that could move a gate are tracked in [12-risks-open-questions.md](12-risks-open-questions.md).

---

*roadmap ends — Draft v0.3, June 12, 2026*
