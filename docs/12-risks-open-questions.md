# spnr — Risks & Open Questions

> Tracked risk register plus the engineering/strategy questions that gate each phase.
> Status: Draft v0.3 · June 12, 2026

This document is the single source of truth for **what could kill spnr** and **what we have
not yet decided**. Every other doc that says "open question — see `12-risks-open-questions.md`"
points here. Risks are scored against the [six design invariants](02-technical-spec.md); open
questions name the phase they gate and how to close them.

Cross-links used below: [00-product-overview.md](00-product-overview.md),
[01-architecture.md](01-architecture.md), [02-technical-spec.md](02-technical-spec.md),
[05-fraud-attestation.md](05-fraud-attestation.md), [06-money-settlement.md](06-money-settlement.md),
[07-security-privacy.md](07-security-privacy.md), [11-phases-roadmap.md](11-phases-roadmap.md),
[13-research-findings.md](13-research-findings.md), [14-go-no-go.md](14-go-no-go.md), and the ADRs
[0001](adr/0001-payout-default-gift-cards-not-api-credits.md),
[0002](adr/0002-statusline-as-coarse-liveness-gate.md),
[0003](adr/0003-x402-batch-settlement-not-per-impression.md),
[0004](adr/0004-platform-risk-adapter-abstraction.md),
[0005](adr/0005-naming-and-domains.md).

---

## Scoring scale

| Axis | Values | Meaning |
|---|---|---|
| **Severity** | existential / high / medium / low | existential = ends the project; high = ends a phase or a revenue line; medium = degrades a feature; low = cosmetic/ops |
| **Likelihood** | likely / possible / unlikely | over the v0.1→v1.0 horizon (≈ 3 months) |
| **Status** | open / mitigated / resolved | resolved = a decision (ADR) closed it; mitigated = control in place, residual risk remains; open = no control yet |

Convention: a risk is only "mitigated" if the mitigation is itself in the build plan
([10-implementation-plan.md](10-implementation-plan.md)) and has an owning phase gate.

---

## PART 1 — Risk register

### R1 · Platform surface continuity (`spinnerVerbs` removable)

| | |
|---|---|
| **Severity** | **Existential** |
| **Likelihood** | possible |
| **Status** | mitigated (residual: high) |

The entire spinner revenue line depends on `spinnerVerbs` remaining a writable host setting.
The format is confirmed (`{ "mode": "replace"\|"append", "verbs": [...] }`, scope precedence
Managed > Local > Project > User), but its **documentation status is contested** and Anthropic
can remove or gate it in a single release with no deprecation guarantee.

> **Research correction:** the source spec treated `spinnerVerbs` as a stable "intentionally
> exposed setting." Research found one stream documenting it at `code.claude.com/docs` and another
> describing it as undocumented / informally shipped (ref `anthropics/claude-code` #21599). Treat it
> as a **fragile, possibly-undocumented surface**. See [13-research-findings.md](13-research-findings.md) §A
> and [ADR-0004](adr/0004-platform-risk-adapter-abstraction.md).

**Mitigation:** the `HostAdapter` trait ([02-technical-spec.md](02-technical-spec.md) §2.4) isolates
the spinner behind `inject()/restore()/event_source()`. If `spinnerVerbs` dies, the spinner adapter
is disabled fleet-wide via a serve-time flag and the network continues in **statusline-only mode**
(reduced earnings, click surface intact). v1 also detects project-level overrides and serves no
impressions there — we never fight the user's config.
**Owner / gate:** adapter abstraction must be load-bearing and tested before **v0.1 GA**; statusline-only
fallback path exercised in the failure matrix ([02-technical-spec.md](02-technical-spec.md) §11) before **v0.2**.

### R2 · Discretionary / brand shutdown by Anthropic

| | |
|---|---|
| **Severity** | **Existential** |
| **Likelihood** | possible |
| **Status** | mitigated (residual: high) |

Even if the surface stays, Anthropic could kill a third-party spinner-ad network for **optics**.
They publicly committed (Feb 2026, Super Bowl LX, "Claude is a space to think") to keeping Claude
ad-free — "no sponsored links," "no third-party product placements our users did not ask for."

> **Research correction:** the harsh "Anthropic will likely shut this down" read does **not** hold.
> The Jan–Apr 2026 enforcement crackdown targeted harnesses that **exported OAuth subscription tokens
> and spoofed the official client** to arbitrage billing/rate limits. spnr does none of that — official
> binary only, no OAuth export, no request routing, it only edits a local display setting. That
> precedent does **not** transfer. Reclassify platform/ToS risk from "likely shutdown" to
> "unadjudicated gray area, but real." See [13-research-findings.md](13-research-findings.md) §B,
> [07-security-privacy.md](07-security-privacy.md).

**Mitigation (hard design constraints):** official binary only; never export OAuth tokens; never route
model requests; **never suppress or spoof host telemetry/heartbeats** (that *was* a crackdown trigger);
clear sponsored disclosure; keep monthly burn low; ship behind the adapter so we can degrade not die.
Maintain a wind-down plan that does **not strand accrued user balances** if the surface vanishes
(pre-funded redemption reserve sized to outstanding liabilities).
**Owner / gate:** monitor Anthropic's first reaction to Kickbacks.ai (highest-signal data point — see Q8);
"no telemetry suppression" is a CI/egress-audit invariant before **v0.1**; balance-protection reserve
policy decided before paid campaigns open (**v0.2**).

### R3 · Statusline fragility weakens the liveness gate

| | |
|---|---|
| **Severity** | **High** |
| **Likelihood** | likely |
| **Status** | mitigated |

The statusline is our anti-fraud liveness signal, but it is buggy: it can **stop updating
mid-session after the first response** (`anthropics/claude-code` #43826) and has had
**OSC-8-stripping regressions** (v2.1.3, v2.1.42 era).

> **Research correction:** the source spec called the statusline a per-frame "render heartbeat" where
> "each invocation == one human-visible render." Refuted — statusline fires on **message boundaries with
> a ~300 ms debounce**, not per paint, and carries **no frame-level timestamp**, so frame-granular
> "device-signed render attestation" is impossible. Reframed as a **coarse liveness gate** in
> [ADR-0002](adr/0002-statusline-as-coarse-liveness-gate.md); see [04-impression-engine.md](04-impression-engine.md)
> and [05-fraud-attestation.md](05-fraud-attestation.md).

**Mitigation:** treat the statusline as a coarse gate over hook-derived WAITING intervals ("a TUI
painted *recently*", within a debounce-widened window), not a per-frame proof. Lean **harder on
server-side fraud scoring** (timing-distribution / KS-test analysis) as the real moat. Decouple clicks
from the spinner: clicks live in the statusline OSC 8 link and are best-effort only (R-related: see R6).
The honest advertiser claim is **"attested + anomaly-filtered," never "viewability-grade."**
**Owner / gate:** empirically measure real statusline cadence and publish the gate-window constant
(see Q2) before **v0.1**; fraud-scoring v1 live before paid campaigns (**v0.2**).

### R4 · Hook reliability & latency

| | |
|---|---|
| **Severity** | **Medium** |
| **Likelihood** | likely |
| **Status** | mitigated |

Hooks are real (7 events used of 26+) but imperfect. `Stop` is **not guaranteed to fire exactly
once** per `UserPromptSubmit` (interrupts, API errors, blocking hooks drop it). Hook timestamps are
inconsistent across versions. Fire-and-forget is **not free** — observed invocation overhead ~200 ms
in some setups. Users can `disableAllHooks`. Exit-code-2 blocking semantics are not uniform.

> **Research correction:** the source spec assumed clean `UserPromptSubmit`→`Stop` bracketing and
> trusted payload timestamps. Both refuted. See [13-research-findings.md](13-research-findings.md) §A.

**Mitigation:** design wait-interval close to **also timeout-close** (the ≤60-impressions/interval cap
already bounds this); **stamp timestamps on daemon receipt** (monotonic + wall-clock), never trust the
payload; **empirically benchmark real end-to-end hook latency** before default-on — if it adds
perceptible latency, make it opt-in or use HTTP hooks; treat `disableAllHooks` as a silent opt-out
(degrade quietly); all hooks exit 0.
**Owner / gate:** latency benchmark is a **v0.1 release gate** (invariant 1 — never degrade the CLI);
timeout-close + daemon-stamped timestamps shipped in `spnrd` for **v0.1**.

### R5 · Credits-wedge refutation (API credit codes)

| | |
|---|---|
| **Severity** | High (was existential to the pitch) |
| **Likelihood** | n/a |
| **Status** | **resolved** ([ADR-0001](adr/0001-payout-default-gift-cards-not-api-credits.md)) |

The day-one differentiator was "redeem as Anthropic/OpenAI API credit codes." That is not legally
or operationally possible.

> **Research correction:** you **cannot** resell API credit codes. Neither provider sells prepaid
> API-credit gift cards or runs a reseller/fulfillment API, and **OpenAI's Service Credit Terms
> explicitly prohibit transfer/sale/gift/trade of Service Credits** (violation → credit revocation +
> account termination). The wedge survives **reframed to gift cards** via a battle-tested aggregator
> rail. See [ADR-0001](adr/0001-payout-default-gift-cards-not-api-credits.md), [06-money-settlement.md](06-money-settlement.md).

**Resolution:** the wedge is now **"instant global gift-card and local-payout redemption via an
aggregator,"** default rail **Tremendous** (free at face value, sandbox, 200+ countries incl. India,
no order minimums). Any "API credits" framing is **indirect and disclosed**: pay general-purpose value
(Amazon / Visa prepaid / local gift card / USD) the dev uses to top up *their own* provider console —
never mint or resell credit codes. Minimum redemption ~$5 (clears gift-card minimums); balances always
USD-denominated. Residual risk → see R7 (provider decision) and R9 (regulatory).

### R6 · Fraud at scale

| | |
|---|---|
| **Severity** | **High** |
| **Likelihood** | likely |
| **Status** | mitigated (residual: high until red-teamed) |

The terminal has no viewability API; fraud is the asset that makes inventory sellable, and the
design ([05-fraud-attestation.md](05-fraud-attestation.md)) is conservative **but unproven**. With the
statusline downgraded (R3), the server-side timing model carries more weight than originally assumed.

**Mitigation:** TTY gate (headless `claude -p` earns nothing — confirmed real, survives); hash-chained
idempotent signed events; **server-side fraud scoring as primary moat** (impressions/hr vs cohort,
heavy-tailed-vs-uniform wait-interval KS distance, heartbeat-to-hook coherence, device↔account graph);
three bands (green/amber/red) with **shadow-discounting** instead of instant bans (no fraud-oracle
feedback); clicks are server-attributed only. **Adversarial red-team phase is mandatory before
high-value campaigns.**
**Owner / gate:** fraud red-team sims (headless loops, heartbeat spammers, replayers, multi-account
farms) must land amber/red within published windows **before any paid campaign opens** (**v0.2 gate**,
[08-testing-strategy.md](08-testing-strategy.md)).

### R7 · Demand-side cold start

| | |
|---|---|
| **Severity** | **High** |
| **Likelihood** | likely |
| **Status** | mitigated |

Supply-side virality ("get paid to wait") without real advertiser demand burns trust
("I earned $40 of nothing"). The incumbent starts from zero real advertisers too; this is a race
both sides begin empty.

> **Research correction:** do **not** model against "$0.011/impression" — that was one tester's
> observed rate ($4.43 / 407 impressions), not a posted price. The $1/block floor implies
> **$0.001/impression**; model against that floor and the real possibility of near-zero demand.
> See [13-research-findings.md](13-research-findings.md) §H, [00-product-overview.md](00-product-overview.md).

**Mitigation:** seed inventory with **honestly labeled house ads** (CloakPipe, ctxgraph) + 3–5 friendly
dev-tool founders at founder pricing; never present house ads as third-party demand; keep earnings copy
truthful and substantiated (ties to R9 FTC earnings claims). Differentiate on **attested events** vs the
incumbent's self-reported local-HTTP counting, and on **payouts that actually clear**.
**Owner / gate:** house-ads labeling enforced in **v0.1** acceptance criteria; honest-earnings copy
reviewed before any public launch.

### R8 · Regulatory exposure (MSB/MTL, India VDA, FTC)

| | |
|---|---|
| **Severity** | **High** |
| **Likelihood** | possible |
| **Status** | mitigated (gated by counsel) |

Three distinct regulatory surfaces, each with its own counsel gate.

| Surface | Exposure | Gate |
|---|---|---|
| **US money transmission** | USDC = convertible virtual currency; accept+transmit CVC ⇒ generally MSB/MTL unless exempt. Closed-loop gift cards/store credit are **excluded** (FinCEN 31 CFR 1010.100(ff)(5)(ii)(E)); under $2,000/user/day also excluded ((ff)(4)(iii)(A)). | **Gift-card/credits-only launch**, per-user daily redemption **< $2,000**, disburse via a licensed vendor (Tremendous/Tango/Reloadly) who carries gift-card/escheat/AML. **US MSB/MTL + crypto legal opinion required before enabling the USDC rail.** |
| **India VDA / tax** | A dev **earning** USDC likely owes ordinary income tax at slab rates on receipt (zero cost basis), **then** 30% (s.115BBH) + 1% TDS (s.194S) on later transfer. | **Draft India tax copy with an Indian CA before India payouts.** |
| **FTC advertising** | 16 CFR Part 255 requires clear-and-conspicuous "sponsored/ad" disclosure; Business Opportunity Rule (16 CFR 437) + pending 2025 FTC earnings-claims rulemaking mean any "earn $X" figure needs written substantiation + "results not typical." | **Advertising counsel before any earnings claims.** |

> **Research correction:** the source spec's "30% + 1% TDS" for India **understates** the
> income-on-receipt event (ordinary income at receipt precedes the 30%/1% on transfer). Closed-loop
> gift cards **materially lower** money-transmitter risk vs the spec's hand-wavy "arguably avoids
> classification." See [13-research-findings.md](13-research-findings.md) §I (informational, not legal advice).

**Four counsel tracks (each gates its phase):** (1) US MSB/MTL+crypto → before USDC, now a **v0.1 pre-launch blocker** per [ADR-0006](adr/0006-crypto-native-agent-economy-launch-wedge.md);
(2) Indian CA → before India payouts; (3) advertising counsel → before earnings claims (**v0.1** copy);
(4) commercial/IP → the credit-resale question (informs R5, already resolved to "don't").
**Owner / gate:** see [14-go-no-go.md](14-go-no-go.md). USDC is the **default v0.1 payout** ([ADR-0006](adr/0006-crypto-native-agent-economy-launch-wedge.md)); its go-live is gated on track (1) + wallet/custody (gate A9 in [11-phases-roadmap.md](11-phases-roadmap.md) / [14-go-no-go.md](14-go-no-go.md)) — a **pre-launch blocker, not a deferred rail**.

### R9 · Key storage not hardware-bound

| | |
|---|---|
| **Severity** | **Medium** |
| **Likelihood** | possible |
| **Status** | mitigated (documented threat model) |

The device signing key is the root of attestation. It is **not** non-exportable.

> **Research correction:** "non-exportable keys" is **false** for the `keyring` crate (4.0.1) — it
> stores readable secret blobs. True non-exportable / Secure-Enclave keys need the abandoned
> `keychain-services` crate or hand-rolled `security-framework` FFI + codesigning. Downgrade the claim
> from "non-exportable" to **"OS-keychain-protected, encrypted-at-rest."** See
> [07-security-privacy.md](07-security-privacy.md), [13-research-findings.md](13-research-findings.md) §F.

**Mitigation:** document the **actual** threat model — a local attacker with the user's session can read
the key, so device identity is "honest until proven otherwise" (invariant 4), and the server treats
every client as hostile (fraud scoring catches key-extraction-then-farm). A **hardware-bound mode**
(Secure Enclave / TPM) is a separate, platform-specific hardening track, **not** a v1 claim.
**Owner / gate:** corrected threat-model wording in [07-security-privacy.md](07-security-privacy.md)
before **v0.1**; hardware-bound mode is a Phase 3 stretch, gated on advertiser demand for higher assurance.

### R10 · Naming / domains not yet secured

| | |
|---|---|
| **Severity** | Medium |
| **Likelihood** | likely (if not acted on) |
| **Status** | open — **act now** ([ADR-0005](adr/0005-naming-and-domains.md)) |

> **Research correction:** the source spec claims `spnr.sh` and `spnr.co` are "owned" — **refuted, both
> are UNREGISTERED/AVAILABLE**; register immediately. crates.io `spnr` is **free** (reserve a 0.0.1
> placeholder now). npm `spnr` is **taken** → publish under scope `@spnr/*`. **GitHub `spnr` is a
> dormant USER account** (id 13784566, since 2015), not free — the earlier "404 → free" checked
> `/orgs/spnr`; pick an alt org handle (`spnr-sh`, `spnrhq`, `getspnr`) or acquire the name. `spnr.dev`
> IS registered (Porkbun, 2023-12-06, serving 502, ownership **unverified** — confirm). `spnr.com` is a
> long-held third-party parked domain (squat/impersonation risk, expires 2026-09-17). See
> [ADR-0005](adr/0005-naming-and-domains.md).

**Mitigation:** register `spnr.sh` + `spnr.co` and reserve crates.io `spnr` **before any public
announcement**; choose and secure the GitHub org handle; confirm who owns `spnr.dev`; keep the
single-canonical-host anti-phishing posture for `spnr.com` ([07-security-privacy.md](07-security-privacy.md)).
**Owner / gate:** all namespace/domain actions are a **pre-announcement (pre-v0.1-public) hard gate.**

### R11 · Hype decay

| | |
|---|---|
| **Severity** | Medium (opportunity, not safety) |
| **Likelihood** | possible |
| **Status** | mitigated |

The category is ~48 hours old and riding a hype wave; it may be a two-week meme.

> **Research correction:** the incumbent's launch was "a viral X launch post" (cited 556K–614K, ~3.6M
> cumulative), **not** a hard "614K launch-day views," and sentiment was **~74% positive / ~26% negative**
> across ~336 comments, **not** "overwhelmingly positive." See [13-research-findings.md](13-research-findings.md) §H.

**Mitigation:** build the **moat pieces as reusable libraries, not app code** — the salvage value if the
meme dies is the **attestation stack + x402 settlement libraries**, both reusable across the portfolio
(e.g. CloakPipe). Ship fast, keep burn low (ties to R2).
**Owner / gate:** `spnr-proto` (SAP/1) and the x402 settlement crates are designed as standalone,
portable libraries from **v0.1**.

---

### Risk summary matrix

| ID | Risk | Severity | Likelihood | Status | Primary mitigation | Gate |
|---|---|---|---|---|---|---|
| R1 | `spinnerVerbs` removable | existential | possible | mitigated | HostAdapter + statusline-only fallback | v0.1 |
| R2 | Discretionary brand shutdown | existential | possible | mitigated | official binary, no telemetry suppression, low burn, wind-down reserve | v0.1 / v0.2 |
| R3 | Statusline fragility | high | likely | mitigated | coarse gate + server fraud scoring (ADR-0002) | v0.1 / v0.2 |
| R4 | Hook reliability/latency | medium | likely | mitigated | benchmark, timeout-close, daemon-stamped ts | v0.1 |
| R5 | Credits-wedge refuted | high | n/a | **resolved** | gift cards via aggregator (ADR-0001) | closed |
| R6 | Fraud at scale | high | likely | mitigated | red-team before paid | v0.2 |
| R7 | Demand cold-start | high | likely | mitigated | honest house ads | v0.1 |
| R8 | Regulatory (MSB/MTL/VDA/FTC) | high | possible | mitigated | four counsel gates | per phase |
| R9 | Key not hardware-bound | medium | possible | mitigated | document threat model | v0.1 |
| R10 | Naming/domains unsecured | medium | likely | **open** | register now (ADR-0005) | pre-announce |
| R11 | Hype decay | medium | possible | mitigated | moat as libraries | v0.1 |

---

## PART 2 — Open questions (tracked, not blockers)

Each question states **how to resolve it** and **which phase it gates**. Source: techspec §15 plus
research. Q1–Q5 are carried forward from [02-technical-spec.md](02-technical-spec.md) §15; Q6–Q8 are
research-driven additions.

### Q1 · Exact hook payload matrix per Claude Code version

- **Question:** which fields (`hook_event_name`, `session_id`, timestamp equivalents) are present, and
  with what names, in each supported Claude Code version? Payload shape varies across versions.
- **How to resolve:** build a tested **version matrix** by capturing real payloads per CC release in the
  host-replay harness ([08-testing-strategy.md](08-testing-strategy.md)); the adapter declares its
  supported version ranges and refuses to count outside them. The content-firewall extractor must tolerate
  field-name drift (skip-and-degrade, never crash).
- **Gates:** **v0.1** (counting correctness on the supported CC version) and every adapter bump.

### Q2 · Statusline cadence throttling / gate window

- **Question:** is statusline invocation throttled by the host under heavy output, and what is the real
  cadence? The ~300 ms debounce ([ADR-0002](adr/0002-statusline-as-coarse-liveness-gate.md)) must be
  measured, not assumed.
- **How to resolve:** **empirically measure** real statusline cadence across terminals/CC versions; if
  effective heartbeat granularity > 2 s, **widen the gate window with a published constant** and document
  the methodology. This directly bounds R3 and R6.
- **Gates:** **v0.1** (the gate constant is part of the published fraud methodology).

### Q3 · Gift-card / payout provider decision

- **Question:** which fulfillment provider(s) for India + global day-one redemption?
- **How to resolve:** **Tremendous is the primary** (free at face value, sandbox, 200+ countries incl.
  India, no order minimums, ~1–2 business-day production approval). Evaluate **Tango Card** (225+
  countries) and **Reloadly** (PIN vouchers) as secondary/redundant rails. Complete the Tremendous
  production-approval application early (lead time is the risk). See [06-money-settlement.md](06-money-settlement.md),
  [ADR-0001](adr/0001-payout-default-gift-cards-not-api-credits.md).
- **Gates:** **v0.1** — day-one redemption *is* the wedge, so this must close before launch.

> **Research correction:** the techspec §15 framing ("Tremendous-class API vs manual codes") is resolved
> in favor of a real aggregator API; manual codes do not scale and "API credit codes" are off the table (R5).

### Q4 · Escrow: custodial address vs on-chain contract

- **Question:** advertiser escrow as a custodial wallet + published address, or a minimal on-chain
  escrow contract?
- **How to resolve:** **start custodial** (segregated wallet, single published on-chain escrow address for
  auditability), move to a contract in **v1.0** if/when volume and legal clarity justify it. Facilitators
  do **not** custody funds — key custody is spnr's burden (consider Coinbase CDP managed wallets or an HSM
  provider; hot wallet spend-capped + cold reserve). See [06-money-settlement.md](06-money-settlement.md),
  [ADR-0003](adr/0003-x402-batch-settlement-not-per-impression.md).
- **Gates:** **v0.1** (USDC is the default payout + custody is on the pre-launch critical path per [ADR-0006](adr/0006-crypto-native-agent-economy-launch-wedge.md)) for custodial; **v1.0** for the contract option.

### Q5 · Windows support

- **Question:** native Windows terminal support, or WSL-only?
- **How to resolve:** **WSL works as Linux today** (ship that). Native Windows is **deferred** — the
  keychain model (DPAPI/Credential Manager vs Secret Service) and the service model (Windows Service vs
  systemd/launchd) differ and need a dedicated adapter + secrets backend. Scope as a separate hardening
  track if Windows-native demand materializes.
- **Gates:** out of scope through **v1.0**; revisit post-v1.0.

### Q6 · `Stop` cardinality (interval bracketing)

- **Question:** since `Stop` is **not** guaranteed once-per-`UserPromptSubmit` (interrupts, API errors,
  blocking hooks drop it), how do we close wait intervals reliably without over- or under-counting?
- **How to resolve:** wait-interval close must **also timeout-close** (daemon-side), never assume clean
  bracketing; the ≤60-impressions/interval cap already bounds a dropped `Stop`; reconcile against the
  JSONL timing cross-check ([04-impression-engine.md](04-impression-engine.md)); always resolve ambiguity
  **against spnr's revenue** (invariant 3). Validate in the host-replay harness with dropped/duplicate
  `Stop` fixtures.
- **Gates:** **v0.1** (counting correctness). Bounds R4 and R6.

### Q7 · Agent-buyer gating (self-contained; MoltNet now optional)

- **Question:** is spnr's own native gate enough to open the public x402 bid API to autonomous agents, or
  do we ever need an external reputation provider?
- **How to resolve:** the gate is **self-contained and already designed** — no external dependency:
  **(a) payment is the gate** (x402 requires real USDC upfront, so spam costs money); **(b) the same
  creative lint** every human advertiser passes; **(c) a human-review queue for first-time buyers**; and
  **(d) spnr's own on-platform buyer reputation**, built from each buyer's payment + creative history. This
  ships at **v1.0** and does not block earlier phases. **MoltNet is now optional, not required** — an
  external reputation provider we can plug in later *only if* the open agent market gets spammy enough to
  warrant it; it is not a launch dependency and GATE 4 does not block on it. See
  [02-technical-spec.md](02-technical-spec.md) §6.3, [01-architecture.md](01-architecture.md),
  [11-phases-roadmap.md](11-phases-roadmap.md) §5.2.
- **Gates:** **v1.0** (agent-buyer API), via the native self-contained gate.

### Q8 · Anthropic's first reaction to Kickbacks.ai

- **Question:** how does Anthropic respond to the incumbent spinner-ad network? This is the **single
  highest-signal data point** for R1 and R2 (surface continuity + discretionary shutdown).
- **How to resolve:** **monitor continuously** — Anthropic public statements, CC release notes touching
  `spinnerVerbs`/hooks/statusline, any ToS/usage-policy edits, and direct enforcement action against
  Kickbacks. Feed observations into the go/no-go assessment ([14-go-no-go.md](14-go-no-go.md)). A hostile
  reaction triggers the R1/R2 wind-down playbook (adapter-disable + balance-protection reserve).
- **Gates:** continuous; informs the **v0.1 public-launch** go/no-go and every subsequent phase.

---

## Change log

| Date | Change |
|---|---|
| 2026-06-12 | Initial register. R5 resolved by ADR-0001; R3 reframed by ADR-0002; R1/R2 by ADR-0004; R10 by ADR-0005. Q1–Q5 carried from techspec §15; Q6–Q8 added from research. |

*Owners and exact phase gates are tracked alongside [10-implementation-plan.md](10-implementation-plan.md)
and [11-phases-roadmap.md](11-phases-roadmap.md); go/no-go thresholds live in [14-go-no-go.md](14-go-no-go.md).*
