# ADR 0003 — Settle developer payouts in aggregated batches, not per-impression on-chain

> Decision record for how spnr moves money between advertisers, the house, and developers over the x402/USDC-on-Base rail.
> **Status: Accepted** · Draft v0.3 · June 12, 2026

Related: [06-money-settlement.md](../06-money-settlement.md) · [ADR 0001 — payout default](0001-payout-default-gift-cards-not-api-credits.md) · [ADR 0006 — crypto-native launch wedge](0006-crypto-native-agent-economy-launch-wedge.md) · [ADR 0004 — platform-risk adapter abstraction](0004-platform-risk-adapter-abstraction.md) · [13-research-findings.md](../13-research-findings.md) · [12-risks-open-questions.md](../12-risks-open-questions.md)

> **Wedge update ([ADR-0006](0006-crypto-native-agent-economy-launch-wedge.md)):** USDC over x402 is now the **default** day-one payout and gift cards / UPI / local are the **fiat off-ramp** (not the default). The **batch-settlement mechanics in this ADR are UNCHANGED**; only the default/off-ramp framing below is updated to match ADR-0006.

---

## Status

**Accepted.** Supersedes the literal reading of product-spec-v0.2 §3 one-liner ("settled per-impression over x402") and tightens tech-spec-v1.0 §8.2.

> **Research correction:** The product spec's headline "settled per-impression over x402, paid out as credits on day one" is economically impossible to take literally — a single Base transaction costs **~$0.002–$0.02** while one impression is worth **~$0.000001–$0.00001** (a 200×–20,000× gap). On-chain settlement is *batch* settlement of an off-chain ledger, never one transaction per impression. The tech spec already implied this ("on-chain batch settlement hourly, off-chain ledger real-time"); this ADR makes it the explicit, load-bearing decision. See [13-research-findings.md](../13-research-findings.md) §D.

---

## Context

### C1. x402/USDC on Base is production-ready

> **Research correction:** Earlier internal doubt about x402 maturity is refuted. x402 is a real, shipped open standard governed by the **Linux Foundation x402 Foundation** (formed April 2, 2026), originated by **Coinbase + Cloudflare + Stripe**, with 22 launch members (incl. AWS, Google, Microsoft, Mastercard, Visa, Circle). See [13-research-findings.md](../13-research-findings.md) §D.

| Property | Value |
|---|---|
| Standard | x402 (HTTP 402 + `PaymentRequirements`), LF x402 Foundation |
| Settlement chain | Base (L2) |
| Asset | USDC, contract `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| Signing primitive | EIP-3009 `transferWithAuthorization` (V1); Permit2 (V2) |
| Typical settlement | ~200 ms |
| Cost per tx | ~$0.0001–$0.002 (facilitator-quoted); ~$0.002–$0.02 effective incl. variance/priority |
| Rust crates | **`x402-axum`** (server) + **`x402-reqwest`** (client), **v1.5.6** on crates.io |
| Chain calls (treasury) | **`alloy-rs`** (not ethers-rs) |

> **Research correction:** Depend on the **component crates** `x402-axum` / `x402-reqwest` at **v1.5.6**, NOT the stale `x402-rs` umbrella crate (0.12.5). Pin to a protocol version (V1 vs V2) explicitly. See [09-repo-build-layout.md](../09-repo-build-layout.md).

### C2. The economics forbid per-impression on-chain settlement

```
impression value      ≈ $0.000001  – $0.00001     (at the $0.001/impression floor and below)
Base transaction cost ≈ $0.002     – $0.02
ratio (cost ÷ value)  ≈ 200×       – 20,000×
```

If spnr broadcast one transaction per impression, **gas would exceed the impression's entire value by 2–4 orders of magnitude** — every payout would be net-negative before the developer saw a cent. This is not a tuning problem; it is a hard floor. The rail must amortize gas across many impressions.

> **Research correction:** product-spec-v0.2 §2.1 cited "~$0.011/impression" as a market rate. That is one tester's observed figure ($4.43 / 407 impressions), not a posted price. Model against the **$1/block → $0.001/impression floor** and the real possibility of near-zero advertiser demand. Even at $0.011, per-impression on-chain settlement still loses money. See [13-research-findings.md](../13-research-findings.md) §H.

### C3. Facilitators do not custody funds

The x402 facilitator only **verifies** the signed payment authorization and **broadcasts** it on Base. It never holds advertiser budgets or developer balances. Therefore:

- Advertiser prepaid budgets and developer payouts live in a **spnr-owned wallet/escrow/key-custody surface**.
- spnr inherits the **security burden** (key handling, hot/cold split, spend caps) and the **regulatory burden** (KYC/AML, money-transmission). See [ADR 0001](0001-payout-default-gift-cards-not-api-credits.md) and [07-security-privacy.md](../07-security-privacy.md).

### C4. Constraints inherited from the invariants

| # | Invariant | Consequence for settlement |
|---|---|---|
| 3 | Undercount, never overcount | Batch boundaries round impressions *down*; partial cents never paid up. |
| 4 | Server-side economic truth | The authoritative balance is the off-chain ledger, not the chain. |
| 6 | Fail quiet, fail stock | A depeg/chain stall pauses payouts; it never errors in the terminal. |

---

## Decision

**Maintain a real-time off-chain double-entry ledger as the source of truth. Aggregate impressions and settle developer USDC payouts in batches — hourly OR when an account crosses a ≥ $1–$5 threshold, whichever comes first. On-chain transactions happen only at batch boundaries.**

### D1. Two-layer money model

```
┌─────────────────────────── OFF-CHAIN (real-time, authoritative) ───────────────────────────┐
│  pgledger (Postgres, double-entry, append-only, ULID-keyed, sum-to-zero)                    │
│  per accepted impression:                                                                   │
│     ad_spend (advertiser escrow → house)                                                    │
│   + imp_earn (house → dev, 50%)                                                             │
│   + hold     (release marker, T+7d)                                                        │
│  balances update at ~tens of writes/s; impressions batched into hourly imp_earn entries     │
└───────────────────────────────────────────┬─────────────────────────────────────────────────┘
                                             │ batch trigger: hourly  OR  balance ≥ threshold
                                             ▼
┌─────────────────────────── ON-CHAIN (batched, Base / USDC) ─────────────────────────────────┐
│  settle service (alloy-rs):                                                                 │
│   - sweep N dev payouts owed → build transfer(s) from hot wallet                            │
│   - broadcast via facilitator; wait 2–3 confirmations; mark redemptions fulfilled           │
│   - depeg breaker gates the whole step                                                      │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

> **Research correction:** Adopt/port **`pgr0ss/pgledger`** rather than hand-rolling the ledger — an all-in-Postgres, PLpgSQL, ULID-keyed, append-only, sum-to-zero double-entry ledger with per-entry balance snapshots that matches the spec almost exactly. See [13-research-findings.md](../13-research-findings.md) §G and [06-money-settlement.md](../06-money-settlement.md).

### D2. Batch settlement trigger

```
# Auto-sweep applies to the USDC rail only. The default gift-card/local rail is
# DEV-INITIATED (pull, not push): the sweep just keeps released balance marked
# redeemable; the developer claims it via `spnr redeem` once it clears $5 (ADR 0001).
settlement_sweep(account):                          # runs hourly / on threshold
    owed := ledger.released_balance(account)        # holds already past T+7d
    if account.rail == usdc:
        if owed < usdc_min_payout($1): return                          # below dust floor
        if depeg_breaker.tripped(): defer(account); return             # see D5
        enqueue_onchain_batch(account, owed)                           # auto push
    else:
        # fiat off-ramp (gift-card/local, ADR-0006) is dev-initiated PULL — no auto-enqueue, no chain.
        mark_redeemable(account, owed)              # dev claims via `spnr redeem` (>= $5); see ADR 0001
```

| Parameter | Value | Rationale |
|---|---|---|
| Hourly tick | every 60 min | predictable gas amortization; bounds payout latency |
| USDC dust floor | ≥ $1 | one Base tx must be a rounding error vs payout, not a tax |
| Gift-card / "instant" threshold | ≥ $5 | clears gift-card minimums/fees ([ADR 0001](0001-payout-default-gift-cards-not-api-credits.md)) |
| Confirmations | 2–3 | finality vs latency on Base |
| Hold period | T+7d rolling | fraud clawback window ([05-fraud-attestation.md](../05-fraud-attestation.md)) |

"Instant" in the product copy means **"as soon as your released balance clears the threshold,"** never "per impression." Balances are always denominated in **USD micros**; USDC is treated 1:1 subject to the breaker (D5).

### D3. Custody topology (spnr-owned)

```
            advertiser funding (card via Stripe  OR  x402/USDC → escrow)
                                   │
                                   ▼
                 ┌────────────────────────────────────┐
                 │  SEGREGATED ESCROW (published addr) │   ← advertiser prepaid budgets only,
                 │  cold-dominant, multi-sig           │     never commingled with operating funds
                 └───────────────┬────────────────────┘
                  cold→hot replenish (manual / capped automation)
                                 ▼
                 ┌────────────────────────────────────┐
                 │  HOT WALLET (MPC or HSM-backed)     │   ← funds batch dev payouts only
                 │  per-tx cap · daily cap · spend-cap │
                 └────────────────────────────────────┘
```

- **Hot wallet:** MPC or HSM-backed, **spend-capped** (per-tx + daily), holds only enough to cover near-term batches. Compromise loss is bounded by the cap.
- **Cold reserve:** holds the bulk; replenishes the hot wallet under policy.
- **Published segregated escrow address:** advertiser escrow is on-chain-auditable; operating funds are kept separate. Supports the "auditable by design" invariant (5).

### D4. Confirmations & idempotency

Every on-chain payout is gated by the same 3-layer idempotency that protects the ledger, so a retried/re-broadcast tx never double-pays:

| Layer | Constraint | Protects against |
|---|---|---|
| Event | `UNIQUE` ULID PK on `events_raw` | duplicate impression events |
| Chain | `UNIQUE(device_id, ctr)` | replayed device counters |
| Economic | `UNIQUE(ledger_ref)` + `ON CONFLICT DO NOTHING` | double-spend per economic event |
| Redemption | client-supplied `idempotency_key` on `redemptions` | duplicate payout requests / tx re-broadcast |

A payout is `pending` until **2–3 confirmations**, then `fulfilled`. A dropped/under-confirmed tx stays `pending` and is safely retried under the same idempotency key.

### D5. Depeg circuit breaker

> **Research correction:** The Chainlink USDC/USD feed on Base trips at roughly **30 bps** of real-world deviation, so a **50 bps** breaker leaves margin while still catching a genuine depeg. Keep the 50 bps threshold and make the peg source **dual** (Chainlink + a DEX TWAP) so a single feed glitch cannot freeze or, worse, mis-price payouts. See [13-research-findings.md](../13-research-findings.md) §D.

```
peg_ok := |chainlink_usdc_usd − 1.0| ≤ 0.0050
       && |dex_twap_usdc_usd  − 1.0| ≤ 0.0050
       && agree(chainlink, dex_twap, tol = 0.0025)

if not peg_ok:  pause all USDC funding AND all USDC payouts   # invariant 6: fail quiet
resume when:    both sources back inside 50 bps for ≥ 15 min  # explicit, published criterion
```

When the breaker is open, USDC payouts **defer to the next clear batch**; the off-chain ledger keeps accruing normally, and credits/gift-card redemption ([ADR 0001](0001-payout-default-gift-cards-not-api-credits.md)) is unaffected.

---

## Consequences

### Positive

- **Predictable gas amortization.** Hundreds–thousands of impressions settle in one Base tx; gas becomes a negligible fraction of payout, not a multiple of it.
- **Off-chain ledger is the moat for correctness.** Real-time balances, instant `spnr status`, fraud holds, and clawbacks all operate on Postgres at full speed; the chain is a slow, auditable settlement tail.
- **Bounded custody blast radius.** Hot wallet is spend-capped and MPC/HSM-backed; cold reserve + published escrow address give auditability without exposing the float.
- **Rail is invisible to off-ramp users.** Fiat-off-ramp developers ([ADR 0001](0001-payout-default-gift-cards-not-api-credits.md) / [ADR 0006](0006-crypto-native-agent-economy-launch-wedge.md)) never touch the chain; default USDC-tier developers receive on-chain USDC directly.

### Negative / costs we accept

- **spnr carries custody.** Facilitators don't hold funds (C3), so key handling, hot/cold split, MPC/HSM, and spend-cap policy are spnr's to build and operate. See [07-security-privacy.md](../07-security-privacy.md).
- **spnr carries the regulatory burden.** Accepting + transmitting USDC ("convertible virtual currency") generally makes the operator an MSB/money transmitter absent an exemption — federal registration + state MTL exposure.

  > **Research correction:** **Gate the USDC rail behind a real money-services/MTL + crypto legal opinion BEFORE enabling it.** Per [ADR-0006](0006-crypto-native-agent-economy-launch-wedge.md) USDC over x402 is the **default day-one payout**, so this legal opinion + wallet/custody are a **v0.1 pre-launch blocker**, not a later gate. The **fiat off-ramp** (gift cards, closed-loop, materially lower money-transmitter risk; keep per-user daily redemption < $2,000) remains available for fiat-preferring / tax-sensitive devs. See [ADR 0001](0001-payout-default-gift-cards-not-api-credits.md) and [13-research-findings.md](../13-research-findings.md) §I.

- **Payout latency.** Developers wait up to one hourly tick (and for the threshold + T+7d hold) — acceptable, because "instant per impression" was never economically real.
- **India tax surface.** A user earning USDC likely owes ordinary income tax on receipt (zero cost basis), then 30% (s.115BBH) + 1% TDS (s.194S) on later transfer. Surface this notice in the USDC (default) payout flow; draft copy with an Indian CA. (This India friction is exactly why the fiat off-ramp is retained — see [ADR-0006](0006-crypto-native-agent-economy-launch-wedge.md).) See [12-risks-open-questions.md](../12-risks-open-questions.md).

### Neutral

- Advertiser **funding** can still arrive per-transaction over x402 (`POST /v1/fund` → 402 → USDC → escrow, credited on 2 confirmations). Funding is naturally chunky ($-denominated budgets), so per-fund on-chain tx is fine — the batching constraint is specifically about **micro-payouts**, not budget top-ups.

---

## Alternatives considered

| Option | Verdict | Why |
|---|---|---|
| **Per-impression on-chain settlement** | Rejected | Gas dwarfs impression value 200×–20,000× (C2). Economically impossible. |
| **Batched off-chain ledger + threshold/hourly on-chain settle** | **Chosen** | Amortizes gas; keeps balances real-time; matches the spec's stated hourly-batch intent. |
| **Coinbase CDP managed wallets** | **Recommended de-risking option** | A managed-wallet / custody provider removes most raw key-handling risk (no self-run MPC/HSM at launch). Trade-off: third-party dependency + provider terms. Evaluate as the **default custody backend** for v0.1 pre-launch USDC custody; published segregated escrow address still required for auditability. See [12-risks-open-questions.md](../12-risks-open-questions.md). |
| **Channel/rollup state channels per device** | Rejected (for now) | Over-engineered for current volume; ledger + batch settle covers it. Revisit only if payout volume makes batch gas material. |
| **Pay everything in stablecoin, no credits tier** | Rejected | Maximizes MSB/MTL exposure and India tax friction for every user; contradicts [ADR 0001](0001-payout-default-gift-cards-not-api-credits.md) / [ADR 0006](0006-crypto-native-agent-economy-launch-wedge.md) (the fiat off-ramp must remain for fiat-preferring / tax-sensitive devs). |

---

## References

- [06-money-settlement.md](../06-money-settlement.md) — full ledger/settlement/redemption design
- [ADR 0001 — payout default gift cards, not API credits](0001-payout-default-gift-cards-not-api-credits.md)
- [ADR 0004 — platform-risk adapter abstraction](0004-platform-risk-adapter-abstraction.md)
- [05-fraud-attestation.md](../05-fraud-attestation.md) — T+7d hold, fraud bands, clawback
- [07-security-privacy.md](../07-security-privacy.md) — key custody, threat model
- [09-repo-build-layout.md](../09-repo-build-layout.md) — `x402-axum`/`x402-reqwest` v1.5.6, `alloy-rs` deps
- [12-risks-open-questions.md](../12-risks-open-questions.md) — custody provider choice, USDC legal gate
- [13-research-findings.md](../13-research-findings.md) — §D (x402/USDC), §G (ledger), §I (legal)
