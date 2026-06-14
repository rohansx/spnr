# ADR 0001 — Payout default is gift cards / local rails, not provider API-credit codes

> Why spnr's day-one payout wedge is "instant global gift-card and local-payout redemption," not "resell Anthropic/OpenAI API credit codes."
> Status: **Accepted** · June 12, 2026
> **Superseded as the *headline/default*** by [ADR-0006](0006-crypto-native-agent-economy-launch-wedge.md): the launch wedge is crypto-native, so **USDC over x402 is the default payout and gift cards / UPI / local payouts (this ADR) are the FIAT OFF-RAMP**, not the default. The core decision of THIS ADR — that Anthropic/OpenAI API **credit codes cannot be resold** and must not be the payout mechanism — STILL STANDS, and Tremendous/Reloadly remain the fiat-rail choice.

| Field | Value |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-06-12 |
| **Supersedes** | `product-spec-v0.2.md` §3.4 (three-tier payout), §3.3.2, §5.1 `spnr redeem` framing |
| **Refines** | `tech-spec-v1.0.md` §8.2 (credits-default redemption), §15 Q3 (fulfillment provider) |
| **Related** | [06-money-settlement.md](../06-money-settlement.md), [13-research-findings.md](../13-research-findings.md) §C/§I, [0003-x402-batch-settlement-not-per-impression.md](0003-x402-batch-settlement-not-per-impression.md), [12-risks-open-questions.md](../12-risks-open-questions.md) |
| **Invariants touched** | None directly; supports the product's "payouts that work day one" wedge without violating invariants 1–6 |

---

## Context

The original product spec (`product-spec-v0.2.md` §3.4) made the headline differentiator vs Kickbacks.ai be **"Day-one redemption: API credits (default)"** — redeem a USD balance into **Anthropic/OpenAI API credit codes** as the default tier. `tech-spec-v1.0.md` §8.2 repeated this: *"redeem ≥ $5 into Anthropic/OpenAI API credit codes or gift cards via fulfillment API."* The implied mechanic was that spnr could mint or resell prepaid provider-API-credit codes through some provider fulfillment API.

Research refuted this wedge as specified.

> **Research correction:** You **cannot** resell Anthropic/OpenAI API credit codes. Neither provider sells prepaid API-credit gift cards or runs a reseller/fulfillment API. **OpenAI's Service Credit Terms explicitly prohibit transfers, sales, gifts, or trades of Service Credits — a violation triggers credit revocation AND account termination.** Provider "redeem promotional credit" paths exist, but credits are issued only through gated programs (hackathons, VC/startup, partner), never a self-serve volume API. See [13-research-findings.md](../13-research-findings.md) §C.

Three independent problems with the original "API credit codes" default:

1. **No supply.** There is no provider reseller/fulfillment API to source codes from at volume. The mechanic the spec assumed does not exist to build against.
2. **Contractual prohibition.** Even if codes could be obtained, transferring/selling/gifting them violates OpenAI's Service Credit Terms (revocation + account termination) and has no sanctioned Anthropic analogue. This is a ToS-enforcement exposure, not a gray area.
3. **Misleading-marketing exposure.** Headlining a default payout that is contractually impossible to deliver invites FTC scrutiny (16 CFR Part 255; the pending 2025 Earnings-Claims rulemaking). See [13-research-findings.md](../13-research-findings.md) §I.

The wedge itself — *"a payout that actually works on day one, globally, including India"* — survives. Only the **delivery instrument** was wrong. Kickbacks.ai still has no live payout (Stripe Connect "coming," $10 min, monthly, US/Stripe-geo only, not shipped), so "payouts that clear day one in 200+ countries" remains a clean, defensible differentiator (`product-spec-v0.2.md` §2.2, §3.1) — *if* the instrument is one that legally and operationally exists.

---

## Decision

**The default payout rail is gift cards and local payouts delivered through a battle-tested licensed reward-platform aggregator, not provider API-credit codes.**

### D1 — Default rail: aggregator gift cards + local payouts

- **Primary provider: Tremendous.**
  - Free at face value (no per-disbursement fee on standard gift-card/payout sends), sandbox environment, **200+ countries including India**, no order minimums, ~1–2 business-day production-account approval.
  - The licensed vendor carries the gift-card issuance / escheat / AML burden (see D6), which is exactly the risk spnr wants off its own balance sheet at launch.
- **Secondary / redundant providers (evaluate, not day-one):** **Tango Card** (225+ countries) and **Reloadly** (PIN vouchers) as failover and coverage-gap fill.
- Redemption catalog presented to the developer: Amazon, Visa/Mastercard prepaid, local-market gift cards, and direct bank/PayPal payout where the provider supports it — all **denominated in USD** on spnr's side, converted by the provider at redemption.

### D2 — "API credits" is allowed only as an indirect, disclosed outcome

The developer may *choose* to spend a redeemed, general-purpose instrument (Amazon / Visa prepaid / local gift card / USD) to top up **their own** Anthropic or OpenAI console. spnr never mints, holds, brokers, or transfers provider Service Credits.

> **Research correction:** Any "fund your Claude/OpenAI usage" story must be **indirect and disclosed** — pay the developer general-purpose value that *they* use on *their own* console, never a spnr-minted or spnr-resold credit code. See [13-research-findings.md](../13-research-findings.md) §C.

Copy rule (enforced in advertiser/portal lint and CLI strings): never imply spnr issues, sells, or guarantees provider API credits. Acceptable: *"redeem to a Visa prepaid card you can use anywhere — including to top up your own Claude or OpenAI account."* Unacceptable: *"get paid in Claude API credits."*

### D3 — USDC over x402 — opt-in *in this ADR*; now the DEFAULT per [ADR-0006](0006-crypto-native-agent-economy-launch-wedge.md); gated either way

USDC over x402 on Base remains an **opt-in** tier (`product-spec-v0.2.md` §3.4 tier 2), not the default, and is gated behind the legal/MTL track in D6. Mechanics, batching, and treasury live in [0003-x402-batch-settlement-not-per-impression.md](0003-x402-batch-settlement-not-per-impression.md) and [06-money-settlement.md](../06-money-settlement.md).

### D4 — Minimum redemption threshold

- **$5 minimum** redemption to clear gift-card minimums and provider fees.
- "Instant" means *instant once the threshold is met*, not per impression. Below $5, the balance accrues and displays in `spnr status`; redemption is unavailable with a clear reason string.

### D5 — Balances always USD

All accrual, display, ledger entries, and redemption quoting are in **USD micros** (matches `tech-spec-v1.0.md` §8.1). No spnr-internal "points," no opaque conversion. The provider performs any local-currency conversion at redemption time and that rate is shown before the user confirms.

### D6 — Legal gating

| Rail | Gate before enabling |
|---|---|
| Gift cards / local payouts (default) | Launchable at v0.1 behind a licensed reward-platform vendor; keep per-user daily redemption **< $2,000** (closed-loop + small-value exclusions, see Consequences) |
| USDC over x402 (opt-in) | Blocked until a US money-services/MTL + crypto legal opinion clears (CVC transmission = MSB/MTL exposure) |
| India payouts | Indian-CA-reviewed tax copy in the redemption flow before enabling India (income-on-receipt + s.115BBH/s.194S; see [13-research-findings.md](../13-research-findings.md) §I) |
| Any "earn $X / pays for your subscription" claim | Advertising-counsel-reviewed, written substantiation + "results not typical" qualifier |

### Redemption decision flow

```
spnr redeem
   │
   ▼
balance ≥ $5 ?  ──no──►  show accrued balance + "minimum $5 to redeem"  (END)
   │ yes
   ▼
choose rail:
   ├─ gift card / local payout  ─► provider (Tremendous default) ─► fulfilled / failed
   │     (default; USD→local FX by provider; <$2,000/user/day cap enforced)
   │
   └─ USDC (opt-in) ──gate──► MTL/crypto opinion cleared & user opted in & wallet test-tx confirmed ?
                                 ├─ no  ─► tier hidden / disabled with reason
                                 └─ yes ─► hourly batch sweep (see ADR-0003)
```

---

## Consequences

### Positive

- **The wedge holds and is now real.** "Instant global gift-card and local-payout redemption via a battle-tested aggregator, 200+ countries including India" is a true, shippable day-one claim — and still beats Kickbacks.ai's not-yet-live, Stripe-geo-limited payout.
- **No ToS-enforcement exposure** from reselling provider credits; no risk of a developer's provider account being terminated because spnr handed them a transferred credit code.
- **No misleading-marketing exposure** from headlining an impossible instrument; positioning is defensible under FTC disclosure rules.
- **Lower money-transmitter risk.** Closed-loop gift cards / store credit materially lower MTL exposure.
  > **Research correction:** FinCEN excludes closed-loop prepaid access (31 CFR 1010.100(ff)(5)(ii)(E)); under $2,000/user/day also excluded from the prepaid-program BSA regime ((ff)(4)(iii)(A)). Launching gift-card-first, keeping per-user daily redemption < $2,000, and disbursing via a *licensed* vendor pushes the gift-card/escheat/AML burden onto that vendor. See [13-research-findings.md](../13-research-findings.md) §I.
- **Faster to ship.** Tremendous sandbox + free-at-face-value means no custody, no chain, no KYC build for the default rail at v0.1 — unblocking `tech-spec-v1.0.md` §15 Q3.

### Negative / costs

- **Positioning and marketing must change.** Every "API credit codes" headline, the §3.4 default-tier label, the §1 comparison-table cell ("Payouts: … API credits (default)"), and CLI/portal copy must be rewritten. Tracked as a corrected-positioning task in [00-product-overview.md](../00-product-overview.md) and [12-risks-open-questions.md](../12-risks-open-questions.md).
- **Provider dependency + margin.** spnr depends on Tremendous (or a secondary) uptime and country coverage; "free at face value" must be re-verified at production-account onboarding, and any future fees flow straight to spnr's take.
- **$5 minimum dilutes the "instant" story** for low-volume users. Mitigation: honest copy ("redeemable once you reach $5"), accrual visible in `spnr status`.
- **Approval latency.** ~1–2 business-day Tremendous production approval must be started before the v0.1 launch window, not after.

### Neutral / follow-ups

- Pursue official Anthropic/OpenAI **startup-credit programs** as a *future, gated, non-guaranteed perk* (see Alternatives A1), never the default.
- Re-confirm Tremendous India coverage, supported instruments, and fee schedule at production onboarding; keep Tango/Reloadly as live failover before relying on a single rail.

---

## Alternatives considered

### A1 — Resell Anthropic/OpenAI API credit codes (the original spec default)

**Rejected.** No provider reseller/fulfillment API exists; OpenAI's Service Credit Terms prohibit transfer/sale/gift/trade (revocation + account termination); no sanctioned Anthropic path. Contractually impossible and a marketing-liability headline. This is the decision this ADR exists to overturn.

### A2 — Provider startup-/promotional-credit programs as the default

**Rejected as a default; retained as a future perk.** Anthropic/OpenAI startup, hackathon, VC/partner credit programs are real but **gated, application-based, and non-guaranteed** — they cannot back a self-serve, per-developer, day-one redemption. Viable only as an optional, clearly-non-guaranteed bonus track later.

### A3 — Stripe Connect / direct fiat payout (the Kickbacks approach)

**Rejected for v1.** Stripe Connect excludes or complicates most of the Global South — including India, a core target audience (`product-spec-v0.2.md` §2.2, §3.2) — and pushes payment-facilitator obligations onto spnr. It is exactly the gap spnr is exploiting; adopting it would forfeit the geo wedge. May appear later as one provider-backed payout option among many.

### A4 — USDC-over-x402 as the default payout

**Rejected as default in THIS ADR; kept opt-in here — but later promoted to the headline default by [ADR-0006](0006-crypto-native-agent-economy-launch-wedge.md).** USDC is "convertible virtual currency"; accepting + transmitting CVC is generally MSB/money-transmitter activity, raising federal MSB registration + state MTL exposure, plus India VDA/TDS complexity. This ADR judged that too much regulatory weight to gate the *default* day-one experience on, so it stayed opt-in behind the D6 legal gate. ADR-0006 makes the opposite *headline* call (crypto-native wedge) and, as a deliberate consequence, **moves the MSB/MTL + crypto legal opinion and wallet/custody onto the pre-launch critical path** — the same regulatory weight flagged here, now accepted and designed for. The fiat rails (this ADR) become the off-ramp. See [13-research-findings.md](../13-research-findings.md) §I and [0003-x402-batch-settlement-not-per-impression.md](0003-x402-batch-settlement-not-per-impression.md).

### A5 — spnr-operated closed-loop store credit only (no cash-out)

**Rejected for the default, noted as a fallback.** Pure closed-loop spnr credit (spend only within spnr) minimizes MTL risk but guts the "get paid" promise — it is effectively the "vague points" pattern the spec explicitly bans (`product-spec-v0.2.md` §3.4 "Never"). Acceptable only as an emergency fallback if all aggregator rails become unavailable, and only with honest "store-credit-only" labeling.

---

*ADR 0001 ends — Accepted, June 12, 2026. The "no API-credit-code resale" rule still stands. Per [ADR-0006](0006-crypto-native-agent-economy-launch-wedge.md), the launch headline/default payout is now USDC over x402; the gift-card / local rails here are the fiat off-ramp, not the default.*
