# ADR 0006 — Crypto-native / agent-economy is the launch wedge

> Status: **Accepted** · 2026-06-12
> Related: [ADR 0001 — payout default](0001-payout-default-gift-cards-not-api-credits.md) · [ADR 0003 — batch settlement](0003-x402-batch-settlement-not-per-impression.md) · [ADR 0004 — platform risk](0004-platform-risk-adapter-abstraction.md) · [06-money-settlement.md](../06-money-settlement.md) · [14-go-no-go.md](../14-go-no-go.md) · [13-research-findings.md](../13-research-findings.md) §D/§I

## Context

Research refuted the original "redeem to Anthropic/OpenAI API credit codes" wedge ([ADR-0001](0001-payout-default-gift-cards-not-api-credits.md)). Three replacement directions were on the table:

- **A** — broaden "day-one payouts" (gift cards / UPI / mobile top-up / USDC), led by the India / Global-South gap.
- **B** — lead with the open protocol + attested-impression moat; payouts as table-stakes.
- **C** — crypto-native identity: x402/USDC-native settlement and **agents buying human attention** as the flagship surface.

The founder chose **C** as the launch headline. This ADR records that decision and — importantly — its
consequences, including the ones that cut against it, so they are designed for rather than discovered later.

## Decision

1. **Identity.** spnr is positioned as **the open, crypto-native, agent-economy ad network for terminal
   wait-states** — settlement is x402/USDC-native (Base) end-to-end, and the novel, defensible surface is
   **autonomous agents purchasing human attention** via the x402 bid API.
2. **Default developer payout = USDC over x402** (Base), to a user-supplied wallet. Balances stay USD-denominated
   in the ledger; USDC is the default settlement of that balance.
3. **Fiat is the off-ramp, not the default.** Gift cards / UPI / local payouts via Tremendous / Reloadly
   ([ADR-0001](0001-payout-default-gift-cards-not-api-credits.md)) remain available for developers who prefer
   fiat or are in tax-sensitive jurisdictions (notably India). The "no API-credit-code resale" rule from
   ADR-0001 still stands.
4. **Agent-buyer surface is foregrounded from launch as the story**, even though the full `POST /v1/bids → 402`
   agent API matures over the roadmap (see [11-phases-roadmap.md](../11-phases-roadmap.md)). The protocol and
   settlement are x402-native from v0.1 so the narrative is true, not aspirational.

## Consequences

**This is the load-bearing section — choosing C moves real work earlier and adds real risk.**

- 🔴 **Regulatory work moves to the PRE-LAUNCH critical path.** USDC is a convertible virtual currency; paying it
  out makes spnr a likely money transmitter / MSB unless an exemption applies ([13-research-findings.md](../13-research-findings.md) §I).
  A **US money-services/MTL + crypto legal opinion is now a v0.1 blocker**, not a later gate. This is the single
  biggest cost of C versus A/B.
- 🔴 **Wallet / custody / escrow + key management are v0.1 critical path** (was later). Hot (MPC/HSM, spend-capped)
  + cold reserve, published segregated escrow address, EIP-3009 nonce tracking, depeg breaker — all needed before
  the first real USDC payout. Consider Coinbase CDP managed wallets to reduce key-handling risk.
- 🟠 **KYC/AML and velocity limits** attach to USDC payouts above thresholds; design the redemption flow for them.
- 🟠 **Tension with the India / Global-South audience.** USDC receipt by an Indian developer is taxed as income on
  receipt (slab rates, zero basis) and 30% (s.115BBH) + 1% TDS (s.194S) on transfer — heavier than gift cards/UPI.
  The fiat off-ramp (UPI / Amazon-India / local) is therefore **retained and surfaced** so the supply side in the
  headline market is not driven away; in-flow VDA/TDS disclosure is mandatory.
- 🟠 **Wallet friction for non-crypto developers** could throttle supply. The fiat off-ramp mitigates; onboarding
  must make "no wallet? get paid in a gift card / UPI instead" a first-class, one-tap choice.
- ⚪ **Unchanged:** per-impression on-chain settlement remains impossible → aggregate + batch
  ([ADR-0003](0003-x402-batch-settlement-not-per-impression.md)); platform/brand risk
  ([ADR-0004](0004-platform-risk-adapter-abstraction.md)); the editor-safety and content-firewall invariants.
- 🟢 **Upside (why C):** the most defensible, least-copyable long game (no fiat-rail incumbent can ship
  agents-buying-attention quickly); global by default (no Stripe-geo limits); composes with the x402/agent
  portfolio narrative; press-worthy. Salvage value (attestation + x402 libraries) is high even if the spinner
  inventory disappears.

## Alternatives considered

- **A — broadened day-one payouts (rejected as headline, retained as off-ramp):** lowest-risk and best India
  fit, but less defensible and less differentiated long-term. Its mechanism (Tremendous/Reloadly/UPI) is kept as
  the fiat off-ramp under [ADR-0001](0001-payout-default-gift-cards-not-api-credits.md).
- **B — open-protocol moat as headline (rejected as headline, retained as narrative):** the open SAP/1 protocol
  and attested impressions remain a core part of the story and the advertiser pitch, just not the lead.

## Impact on other docs

[00-product-overview.md](../00-product-overview.md) (positioning/wedge/payout/GTM), [06-money-settlement.md](../06-money-settlement.md)
(USDC default, fiat off-ramp), [10-implementation-plan.md](../10-implementation-plan.md) (legal + custody → pre-work),
[11-phases-roadmap.md](../11-phases-roadmap.md) (USDC + agent-narrative in v0.1; legal gate), and
[14-go-no-go.md](../14-go-no-go.md) (readiness now gated on the MSB/MTL opinion) are updated to match.
