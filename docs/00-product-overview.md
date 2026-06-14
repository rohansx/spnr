# spnr — Product Overview

> Refined product overview with corrected positioning. The open, crypto-native, agent-economy ad network for terminal wait-states.
>
> **Status:** Draft v0.4 · June 12, 2026

This document supersedes the positioning in `source/product-spec-v0.2.md`. Where the original spec made an
optimistic claim that research later refuted (API-credit resale, "viewability-grade" impressions, viral-metric
overstatements), this document reflects the corrected reality. See `13-research-findings.md` and the ADRs for
the validated evidence.

> **Wedge (ADR-0006):** the launch headline is **crypto-native / agent-economy** — x402/USDC-native settlement
> (Base) end-to-end, with **autonomous agents able to buy human attention** as the foregrounded story. The
> **default developer payout is USDC over x402**; the fiat rail (gift cards / UPI / local via Tremendous /
> Reloadly) is the **off-ramp** for fiat-preferring or tax-sensitive devs, not the default. This is intentionally
> the higher-risk, more-defensible bet: it moves the **US money-services/MTL + crypto legal opinion** and
> **wallet/custody** onto the pre-launch critical path. See [ADR-0006](adr/0006-crypto-native-agent-economy-launch-wedge.md)
> and `14-go-no-go.md`.

---

## 1. One-liner & status

**spnr** is an open, crypto-native, agent-economy ad network that monetizes the AI-coding-agent "spinner" wait
state (Claude Code / Codex CLI). When your agent is thinking, the spinner shows a sponsored line; you earn a USD
balance; it settles to **USDC over x402** by default (or a gift card / local payout if you prefer fiat). The
novel, defensible surface is **autonomous agents purchasing human attention** via the x402 bid API.

- **One-liner:** *The open, crypto-native, agent-economy ad network for terminal wait-states — x402/USDC-native
  settlement, with autonomous agents able to buy human attention.*
- **Status:** Pre-launch. Category is ~24 hours old (Kickbacks.ai launched June 11, 2026). Realistic window to
  ship a credible alternative: a few weeks — gated on the money-transmission legal opinion and wallet/custody
  work now on the critical path. See `11-phases-roadmap.md` and `14-go-no-go.md`.
- **Core bet:** be the *terminal-native, crypto-native, agent-buyable, open* network — not the highest payout,
  not the flashiest metric.

> **Research correction:** the original spec's one-liner promised settlement "paid out as credits on day one."
> "Credits" implied resellable Anthropic/OpenAI API credit codes — which is **refuted**. The default settlement
> is **USDC over x402**; the fiat off-ramp is **gift cards and local rails via Tremendous / Reloadly**, not API
> credits. See [ADR-0006](adr/0006-crypto-native-agent-economy-launch-wedge.md) and [ADR-0001](adr/0001-payout-default-gift-cards-not-api-credits.md).

---

## 2. Positioning

Three audiences, three sentences. The wedge differs per audience but the moat is shared.

### 2.1 For developers

> "Your agent's spinner pays you in USDC over x402 by default — or cash it out as a gift card / local payout if
> you'd rather have fiat, including India."

The wedge is **crypto-native settlement that's global by default** — USDC over x402 to your wallet, with a
fiat off-ramp (gift cards and local rails via Tremendous / Reloadly) for developers who prefer fiat or are in
tax-sensitive jurisdictions. One-command install (`curl | sh` or a Claude Code plugin), redeem from a terminal,
balance always denominated in USD.

### 2.2 For advertisers

> "The only **attested, anomaly-filtered** terminal ad slot — and the only one **agents can bid on** — reach
> developers (and the agents acting for them) actively running AI coding tools."

The honest claim is **attested + anomaly-filtered impressions**, never "viewability-grade." Terminal inventory
cannot offer DOM-grade viewability; spnr instead offers cryptographically signed, hash-chained, idempotent
impression events plus server-side fraud scoring, with published methodology and per-campaign attestation
coverage. The foregrounded novelty is the **x402 agent-buyer surface** — autonomous agents purchasing
human-attention slots. See `05-fraud-attestation.md` and `06-money-settlement.md`.

> **Research correction:** the spinner is **plain text and not clickable**; OSC 8 hyperlinks live in the
> statusline only. Clicks are a best-effort bonus signal, server-attributed via a `/c/{code}` redirect — never
> the core revenue line, which is impression-based. See [ADR-0002](adr/0002-statusline-as-coarse-liveness-gate.md)
> and `04-impression-engine.md`.

### 2.3 For the ecosystem

> "An open, x402-native protocol (SAP/1) anyone can run — spnr operates the flagship network, not a walled garden."

The event/attestation/settlement protocol is published at spnr.dev (provisional — domain ownership unverified; see [ADR-0005](adr/0005-naming-and-domains.md)) as `03-protocol-SAP1.md`. Client code is
open source and reproducible (invariant 5). The auction logic and attestation verifier are open as the
reference implementation; only ops glue stays private. Settlement is x402/USDC-native from v0.1, so the
crypto-native narrative is true rather than aspirational.

---

## 3. Target users

### 3.1 Supply side (developers earning)

| Segment | Why they're underserved today | spnr's hook |
|---|---|---|
| Terminal-first Claude Code / Codex CLI users | Kickbacks deprioritized them ("Apologies, terminal jockeys") | Terminal-native from line 1 |
| Crypto-native / global devs | Fiat payout rails are geo-fenced and slow | USDC over x402 by default — global, wallet-direct, no Stripe-geo limits |
| International devs (India, SEA, Africa, LATAM) | Stripe payouts exclude/complicate the Global South | Fiat off-ramp: gift cards & local rails via Tremendous / Reloadly (200+ countries incl. India) |
| Privacy-conscious devs | Won't run closed telemetry binaries | Open source, reproducible, content-firewalled (invariant 2) |

### 3.2 Demand side (advertisers buying)

| Segment | Phase | Notes |
|---|---|---|
| **Agents-as-buyers** (autonomous agents purchasing human-attention slots via x402) | **Foregrounded from launch as the story; full bid API matures over the roadmap** | The novel, defensible surface — no fiat-rail competitor copies this quickly. x402-native from v0.1; behind spnr's own self-contained gate (payment-as-gate + same creative lint + human-review queue for first-time buyers + on-platform buyer reputation) as it matures. See `06-money-settlement.md` and `11-phases-roadmap.md`. |
| Dev-tool companies (Linear/Vercel/Sentry tier) | v1 | The proven buyer profile; highest-intent dev audience |
| AI infra / API companies targeting agent users | v1 | Native fit for the audience |

> **Honest framing:** like Kickbacks, spnr starts with **zero real third-party advertisers** and must seed
> inventory with house ads (clearly labeled). Supply-side virality without real demand burns trust ("I earned
> $40 of nothing"). See `12-risks-open-questions.md`.

---

## 4. Core value propositions

1. **Crypto-native settlement by default.** Earnings settle as **USDC over x402 on Base** to a user-supplied
   wallet — global by default, no Stripe-geo limits, wallet-direct. Balances are **always denominated in USD**
   in the ledger; USDC is the default settlement of that balance. Settlement is x402-native from v0.1.
   > **Intellectual honesty:** USDC is a convertible virtual currency, so paying it out makes spnr a likely
   > money transmitter / MSB unless an exemption applies — **USDC payouts are gated on a US money-services/MTL +
   > crypto legal opinion that is a v0.1 blocker, not a later gate**, and on wallet/custody being in place.
   > In India, USDC receipt is taxed as income on receipt plus 30% (s.115BBH) + 1% TDS (s.194S) on transfer —
   > heavier than the fiat off-ramp. See [ADR-0006](adr/0006-crypto-native-agent-economy-launch-wedge.md),
   > `14-go-no-go.md`, and `06-money-settlement.md`.
2. **Fiat off-ramp that works day one.** For developers who prefer fiat or are tax-sensitive, earnings redeem
   as gift cards / local payouts through a battle-tested aggregator (Tremendous; Reloadly as backup), once a
   minimum threshold (~$5) is met. "No wallet? get paid in a gift card / UPI instead" is a first-class, one-tap
   onboarding choice. Never opaque "points."
   > **Research correction:** redemption is **not** Anthropic/OpenAI API credit codes. Neither provider sells
   > prepaid API-credit gift cards or runs a reseller API, and OpenAI's Service Credit Terms explicitly prohibit
   > transfer/sale of credits. Any "API credits" story is indirect (pay general-purpose value the dev uses to top
   > up their own console) and disclosed. See [ADR-0001](adr/0001-payout-default-gift-cards-not-api-credits.md).
3. **The x402 agent-buyer surface.** Autonomous agents can purchase human-attention slots via the x402 bid API —
   the foregrounded, least-copyable surface. The protocol is x402-native from v0.1 so the narrative is true;
   the full `POST /v1/bids → 402` agent API matures over the roadmap. See `06-money-settlement.md` and
   `11-phases-roadmap.md`.
4. **Attested, anomaly-filtered impressions.** Signed Ed25519 events, per-device hash chain, monotonic counter,
   server-side fraud scoring. The sellable proof terminal inventory never had — priced as what it is, not
   oversold. See `05-fraud-attestation.md`.
5. **Auditable by design.** Every client byte is open source and reproducible (published hashes). `spnr audit`
   dumps the raw outbound queue. The schema *is* the privacy policy. See `07-security-privacy.md`.
6. **Never reads work product.** The daemon reads timing metadata only — never code, prompts, completions,
   paths, repo names, or transcript content. Enforced by a CI content firewall (invariant 2). See `07-security-privacy.md`.
7. **Fail quiet, fail stock.** No network → cached creative until TTL → stock spinner verbs. Never a stale ad,
   never an error in the terminal (invariant 6).

---

## 5. Payout model

Three tiers. The default is crypto-native and gated behind the money-transmission legal opinion + custody;
the fiat off-ramp works day one and carries the lowest regulatory burden; the "never" tier names the
trust-destroying patterns we refuse. Balances are **always denominated in USD** in the ledger regardless of rail.

| Tier | Mechanism | Rail | Who it's for | Constraints |
|---|---|---|---|---|
| **Default** | USDC stablecoin | **x402 over USDC on Base** | Everyone (crypto-native default) | Gated behind US MSB/MTL + crypto legal opinion BEFORE enabling (v0.1 blocker) and wallet/custody being in place; hourly **batch** settlement (per-impression on-chain is impossible); KYC/AML + velocity limits above thresholds; India income-on-receipt + 30% + 1% TDS notice surfaced in-flow |
| **Off-ramp** | Gift cards & local payouts (incl. UPI) | **Tremendous** (Reloadly as backup; eval Tango Card) | Fiat-preferring / tax-sensitive devs (notably India); devs without a wallet | Min redemption ~$5; per-user daily redemption < $2,000 (keeps closed-loop FinCEN exclusion); ~1–2 business-day vendor approval; 200+ countries incl. India; one-tap "no wallet? get a gift card / UPI" onboarding choice |
| **Never** | Opaque points · watch-to-earn · streak/multiplier gamification · crypto-as-marketing | — | — | Out of scope, permanently. Trust-destroying. |

> **Research correction (Default rail):** x402 is real and production-ready (Linux Foundation x402 Foundation,
> formed April 2, 2026; originated by Coinbase + Cloudflare + Stripe). But per-impression on-chain settlement is
> economically impossible (Base tx ~$0.002–$0.02 vs impression value ~$0.000001–$0.00001), so payouts **must**
> aggregate and settle in batches. See [ADR-0003](adr/0003-x402-batch-settlement-not-per-impression.md).

> **Research correction (Off-ramp rail):** the off-ramp is **"instant global gift-card and local-payout
> redemption via a battle-tested aggregator rail (Tremendous / Reloadly),"** not "API credit resale."
> Tremendous is free at face value, has a sandbox, 200+ countries, and no order minimums. See
> [ADR-0001](adr/0001-payout-default-gift-cards-not-api-credits.md) and `06-money-settlement.md`.

---

## 6. Business model

Match the incumbent's proven mechanics; differentiate on crypto-native settlement, the agent-buyer surface,
and attestation, not on price.

| Lever | Value | Rationale |
|---|---|---|
| **Take rate** | 50% to developer / 50% to protocol+ops | Match incumbent. Higher = race to bottom on margin; lower = loses supply. |
| **Inventory unit** | 1 block = **1,000 impressions** of 5 s each | Industry-anchored to Kickbacks for buyer familiarity. |
| **Floor price** | **$1 / block** minimum bid | Implies a **$0.001 / impression** floor (see correction below). |
| **Clicks** | billed at **50×** the per-impression price | Matches incumbent; clicks are server-attributed bonus signal, not core revenue. |
| **Auction** | Open ascending, highest-bid-serves, FIFO within price | Continuous market; no timed auction; anti-self-dealing enforced server-side. See `02-technical-spec.md` §6. |
| **Agent-buyer & premium revenue** | x402 agent-buyer API fees, targeting premiums (geo/adapter slots), managed self-host | The agent-buyer surface is the novel, foregrounded line; priced above the blind slot. |

> **Research correction (pricing):** model against the **$0.001/impression floor**, not the widely-cited
> "$0.011/impression." The $0.011 figure is one tester's observed rate ($4.43 / 407 impressions) on Kickbacks,
> **not a posted price**, and likely reflects early bootstrapped demand. Plan for the real possibility of
> **near-zero advertiser demand**. See `13-research-findings.md` §H.

---

## 7. Go-to-market

| Phase | Window | Actions |
|---|---|---|
| **Launch** | Week 1 | Ship MVP (terminal daemon + USDC-over-x402 settlement live once the money-transmission legal opinion + custody clear + fiat off-ramp via Tremendous + self-serve advertiser page). Launch on HN/X positioned as **"the open, crypto-native, agent-economy one — x402/USDC-native, agents can buy attention."** Seed inventory with own projects + 3–5 friendly dev-tool founders at founder pricing, all labeled house/founder ads. |
| **Distribution** | Weeks 2–3 | Claude Code plugin path; India / Mumbai dev-community push routed through the **fiat off-ramp** ("get paid in India via UPI / Amazon-India" is the local hook — with a mandatory VDA/TDS disclosure note, since USDC is heavier in India); publish SAP/1 as an x402-native RFC to anchor the open-protocol narrative. |
| **Agent beat** | Month 2+ | Mature the x402 agent-buyer API behind spnr's own self-contained gate (x402 payment-as-gate + same creative lint + human-review queue for first-time buyers + on-platform buyer reputation). MoltNet is an optional external reputation provider we can plug in later if the open agent market gets spammy — not a launch dependency. The press-worthy surface no fiat-rail competitor can copy fast; foregrounded as the story from day one. |

### 7.1 Correcting the Kickbacks launch narrative (used in our positioning)

We must not repeat overstated competitor metrics in our own marketing — it undercuts the "honest over hype"
posture that *is* our wedge.

> **Research correction:** the "~614K launch-day views" figure is a **snapshot of one viral X launch post**
> (cited variously 556K–614K; ~3.6M cumulative per secondary coverage) — say "a viral X launch post," not a hard
> 614K. "Overwhelmingly positive sentiment" is **overstated**: measured sentiment was ~74% positive / ~26%
> negative across ~336 comments, and the HN submission was tiny. See `13-research-findings.md` §H.

The honest takeaway: Kickbacks proved *attention and viral distribution exist* for this category, and that an
ad **outside** the context window is tolerated where an ad **inside** model output would not be. It did **not**
prove durable demand or positive consensus.

---

## 8. Explicit non-goals (v1)

- **No ads inside model output or the context window — ever.** Surface is spinner (impression-only) + statusline
  (click link) only.
- **No DOM injection / no clicking the spinner.** The spinner is plain text. (Phase 3 browser surface, if ever,
  renders only in extension-owned UI — see `11-phases-roadmap.md`.)
- **No reselling or minting Anthropic/OpenAI API credit codes.** Refuted and prohibited; see [ADR-0001](adr/0001-payout-default-gift-cards-not-api-credits.md).
- **No claim of "viewability-grade" impressions.** Attested + anomaly-filtered only.
- **No collection of code, prompts, file paths, repo names, or transcript content.**
- **No engagement mechanics** (streaks, multipliers, gamification, watch-to-earn).
- **No suppressing or spoofing host telemetry/heartbeats** — that was a detection trigger in Anthropic's
  Jan–Apr 2026 crackdown; spnr stays on the unmodified official binary. See `13-research-findings.md` §B.
- **No USDC rail — i.e. no real payouts at all by default — until a money-services/MTL + crypto legal opinion
  clears it and wallet/custody is in place.** This is the single biggest cost of the crypto-native wedge; see
  [ADR-0006](adr/0006-crypto-native-agent-economy-launch-wedge.md) and `14-go-no-go.md`.

---

## 9. Comparison vs Kickbacks.ai (corrected)

Kickbacks.ai launched June 11, 2026 (Andrew McCalip). Confirmed shared mechanics: 1,000×5s blocks, clicks at
50× impression rate, open ascending auction from $1, highest-bid-serves, 50/50 dev split, spinnerVerbs
replacement architecture.

| Dimension | Kickbacks.ai | spnr |
|---|---|---|
| **Primary surface** | VS-Code-first; terminal explicitly deprioritized | Terminal-native (CLI-first), IDE-compatible later |
| **Settlement rail** | Fiat only — Stripe Connect "coming" ($10 min, monthly), **NOT live** | **Crypto-native: USDC over x402 on Base by default** (USD-denominated ledger); fiat off-ramp as fallback |
| **Payouts** | Stripe Connect "coming" — **NOT live** | USDC over x402 (default, gated on MTL opinion + custody); gift cards & local payouts via Tremendous/Reloadly off-ramp, ~$5 min |
| **Geo coverage** | Stripe-supported countries only | **Global by default** (USDC, no Stripe-geo limits); fiat off-ramp 200+ countries incl. India |
| **Agents-as-buyers** | No | **Yes — foregrounded from launch** (x402 bid API, behind spnr's own self-contained gate as it matures); no fiat-rail competitor copies this quickly |
| **Backend** | Closed | **Open, x402-native protocol (SAP/1)** + open-source reference impl; self-hostable |
| **Impression integrity** | Self-reported local-HTTP impression counting | Signed, hash-chained, idempotent events + server-side fraud scoring |
| **Advertiser claim** | (implicit) | "Attested + anomaly-filtered" — explicit, never "viewability-grade" |
| **Real third-party advertisers** | None (bootstraps own inventory) | None yet (house ads, honestly labeled) — same cold start |

> **Research correction:** earlier framings of Kickbacks as having "overwhelmingly positive" reception and a
> hard 614K view count are overstated — see §7.1. spnr's clean, defensible wedges are **(1) crypto-native /
> agent-economy (x402/USDC-native, agents-as-buyers, open protocol, global by default)** and **(2) terminal-native**.
> We differentiate on attested events vs Kickbacks' self-reported counting — not on price. See `13-research-findings.md` §H.

---

## 10. Platform-risk context (read before betting the company)

spnr's continuity depends on host primitives Anthropic controls. The harsh "Anthropic will shut this down"
read does **not** transfer from the Jan–Apr 2026 crackdown (which targeted OAuth-token-exporting, request-routing
harnesses — none of which spnr does). But real risks remain and are treated as existential in the architecture:

1. **Surface continuity.** `spinnerVerbs` is a fragile, possibly-undocumented surface Anthropic can remove or
   gate in one release with no deprecation guarantee. Mitigated by the `HostAdapter` trait + statusline-only
   fallback. See [ADR-0004](adr/0004-platform-risk-adapter-abstraction.md).
2. **Discretionary brand/PR shutdown.** Anthropic publicly committed (Feb 2026, Super Bowl LX) to keeping Claude
   ad-free; a visible third-party spinner-ad network could be killed for optics.
3. **Regulatory exposure from the crypto-native wedge.** USDC payouts put MSB/MTL + crypto-legal risk on the
   pre-launch critical path — the biggest cost of the ADR-0006 wedge versus a fiat-led one. See
   [ADR-0006](adr/0006-crypto-native-agent-economy-launch-wedge.md) and `14-go-no-go.md`.
4. **Monitor Kickbacks.ai** as the single highest-signal data point on Anthropic's tolerance.

Keep burn low, ship behind the adapter abstraction, and have a plan that does not strand accrued user balances
if the surface vanishes. Full register in `12-risks-open-questions.md`.

---

## 11. Where to go next

- System design → `01-architecture.md`
- Consolidated engineering spec → `02-technical-spec.md`
- The published protocol → `03-protocol-SAP1.md`
- How impressions are measured → `04-impression-engine.md`
- Anti-fraud & attestation (the moat) → `05-fraud-attestation.md`
- Money, ledger, redemption (USDC-default wedge + fiat off-ramp) → `06-money-settlement.md`
- Launch readiness (gated on the MSB/MTL opinion) → `14-go-no-go.md`
- Risks & open questions → `12-risks-open-questions.md`
- The validated research behind every correction here → `13-research-findings.md`
- Key decisions → [ADR-0006](adr/0006-crypto-native-agent-economy-launch-wedge.md) (launch wedge) ·
  [ADR-0001](adr/0001-payout-default-gift-cards-not-api-credits.md) ·
  [ADR-0002](adr/0002-statusline-as-coarse-liveness-gate.md) ·
  [ADR-0003](adr/0003-x402-batch-settlement-not-per-impression.md) ·
  [ADR-0004](adr/0004-platform-risk-adapter-abstraction.md) ·
  [ADR-0005](adr/0005-naming-and-domains.md)

*overview ends — Draft v0.4, June 12, 2026 · honest over hype*
