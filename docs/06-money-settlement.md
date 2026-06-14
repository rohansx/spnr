# 06 — Money: Ledger, Settlement & Redemption

> The economic core of spnr: an append-only double-entry ledger, a batched x402/USDC settlement rail, and a USDC-default redemption flow with a fiat off-ramp. This is where "honest over hype" matters most — per the crypto-native launch wedge ([adr/0006-crypto-native-agent-economy-launch-wedge.md](adr/0006-crypto-native-agent-economy-launch-wedge.md)), the **default developer payout is USDC over x402 (Base)**; gift cards / UPI / local payouts via Tremendous/Reloadly are the **fiat off-ramp** (opt-in, for fiat-preferring or tax-sensitive devs, notably India), still honoring ADR-0001 (no "resell API credit codes"; $5 min). USDC-as-default is honest about its cost: it moves the MSB/MTL + crypto legal opinion and wallet/custody onto the pre-launch critical path (see callout below).
>
> **Status: Draft v0.4 · June 12, 2026**

Related docs: [03-protocol-SAP1.md](03-protocol-SAP1.md) (event idempotency keys feeding the ledger), [04-impression-engine.md](04-impression-engine.md) (what counts as a billable impression), [05-fraud-attestation.md](05-fraud-attestation.md) (fraud bands that gate accrual/release), [07-security-privacy.md](07-security-privacy.md) (escrow/key custody threat model), [12-risks-open-questions.md](12-risks-open-questions.md) (open legal/treasury questions), [13-research-findings.md](13-research-findings.md) (validated corrections + citations), [adr/0006-crypto-native-agent-economy-launch-wedge.md](adr/0006-crypto-native-agent-economy-launch-wedge.md) (USDC default, fiat off-ramp), [adr/0001-payout-default-gift-cards-not-api-credits.md](adr/0001-payout-default-gift-cards-not-api-credits.md), [adr/0003-x402-batch-settlement-not-per-impression.md](adr/0003-x402-batch-settlement-not-per-impression.md).

> 🔴 **Critical-path callout (ADR-0006):** making USDC the **default** payout — not an opt-in tier — moves the **US money-services/MTL + crypto legal opinion and the wallet / custody / escrow + key-management build onto the PRE-LAUNCH critical path**. Paying out USDC (a convertible virtual currency) makes spnr a likely money transmitter / MSB unless an exemption applies; this is now a **v0.1 blocker**, not a later gate. See [adr/0006-crypto-native-agent-economy-launch-wedge.md](adr/0006-crypto-native-agent-economy-launch-wedge.md), [14-go-no-go.md](14-go-no-go.md) (readiness gated on the MSB/MTL opinion), and [13-research-findings.md](13-research-findings.md) §I. The fiat off-ramp (Tremendous/Reloadly) stays first-class so wallet-less and tax-sensitive developers are not driven away.

---

## 1. Money invariants

Every rule below derives from the six design invariants ([13-research-findings.md](13-research-findings.md)). The money-specific reads:

| # | Invariant | Money consequence |
|---|---|---|
| 3 | Undercount, never overcount | A billable economic event is only minted from a *server-accepted* impression (after fraud band check). Ambiguity → no ledger entry. |
| 4 | Machine honest until proven; network hostile | The ledger is server-authoritative. No client message ever writes a credit balance directly; it produces an *event*, the server mints the entry. |
| — | USD always | Every balance, entry, and threshold is denominated in **USD micros** (`amount_usd_micros`, 1 USD = 1_000_000). USDC is treated 1:1 with USD behind a depeg breaker (§5.4), never as the unit of account. |
| — | Append-only | The ledger is never updated in place. Corrections are compensating entries (`fraud_clawback`, `release`), never edits. |

---

## 2. Double-entry append-only ledger (Postgres)

### 2.1 Adopt, don't hand-roll — port `pgr0ss/pgledger`

> **Research correction:** Rather than hand-rolling a ledger, adopt/port **`pgr0ss/pgledger`** — an all-in-Postgres, PL/pgSQL-function, ULID-keyed, append-only, sum-to-zero double-entry ledger with per-entry balance snapshots. It matches this spec almost exactly; reuse over rewrite (see [13-research-findings.md](13-research-findings.md) §G).

What `pgledger` gives us out of the box, and how we map onto it:

| pgledger primitive | spnr usage |
|---|---|
| ULID-keyed entries | `ledger_entries.id` (also enables time-sortable ordering) |
| Append-only, no UPDATE/DELETE on entry rows | Enforced by trigger + grant; corrections are new entries |
| Sum-to-zero invariant (every transaction balances) | Each economic event is a balanced *transaction* of ≥2 entries |
| Per-entry running balance snapshot | `balance_after_micros` per account, read without a full scan |
| Transfers via PL/pgSQL function (`pgledger_create_transfer`) | Wrapped by `mint_impression(...)`, `mint_redeem(...)` SQL functions |

Postgres 16 is the control-plane DB (per [tech-spec §9](source/tech-spec-v1.0.md)). The ledger lives here; raw events live in ClickHouse.

### 2.2 Schema

```sql
-- Accounts: the parties between which value moves.
CREATE TABLE accounts (
  id          TEXT PRIMARY KEY,                 -- ULID
  kind        TEXT NOT NULL CHECK (kind IN ('dev','advertiser','house','escrow')),
  email       TEXT,                             -- NULL for house/escrow system accounts
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Devices: pseudonymous signing identities, linked to a dev account for crediting.
CREATE TABLE devices (
  id          TEXT PRIMARY KEY,                 -- base32(pubkey[..10]) per SAP/1
  account_id  TEXT NOT NULL REFERENCES accounts(id),
  pubkey      BYTEA NOT NULL,
  chain_head  TEXT,                             -- BLAKE3 of last accepted event
  ctr_head    BIGINT NOT NULL DEFAULT 0,        -- last accepted monotonic counter
  fraud_band  TEXT NOT NULL DEFAULT 'green' CHECK (fraud_band IN ('green','amber','red')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE campaigns (
  id                 TEXT PRIMARY KEY,
  advertiser_id      TEXT NOT NULL REFERENCES accounts(id),
  price_per_block_usd_micros BIGINT NOT NULL CHECK (price_per_block_usd_micros >= 1000000), -- ≥ $1/block
  blocks_bought      INT NOT NULL DEFAULT 0,
  blocks_served      INT NOT NULL DEFAULT 0,
  state              TEXT NOT NULL CHECK (state IN ('draft','funded','serving','exhausted','paused'))
);

CREATE TABLE creatives (
  id           TEXT PRIMARY KEY,
  campaign_id  TEXT NOT NULL REFERENCES campaigns(id),
  text         TEXT NOT NULL,                   -- ≤48 chars, plain-text spinner copy (see 04)
  url          TEXT NOT NULL,                   -- allow-listed; statusline OSC-8 target (see 04, §E)
  short_code   TEXT NOT NULL UNIQUE,            -- /c/{short_code}
  lint_version INT NOT NULL,
  approved_by  TEXT
);

-- The ledger. Append-only. Each row is ONE leg of a balanced transaction.
CREATE TABLE ledger_entries (
  id                  TEXT PRIMARY KEY,         -- ULID
  txn_id              TEXT NOT NULL,            -- groups the balanced legs of one economic event
  ts                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  account_id          TEXT NOT NULL REFERENCES accounts(id),
  delta_usd_micros    BIGINT NOT NULL,         -- signed; SUM over a txn_id must = 0
  balance_after_micros BIGINT NOT NULL,        -- running snapshot for account_id
  kind                TEXT NOT NULL CHECK (kind IN
                        ('ad_spend','imp_earn','click_earn','hold','release','redeem','fraud_clawback')),
  ref                 TEXT NOT NULL,            -- idempotency key for the economic event (see §3)
  release_at          TIMESTAMPTZ,             -- set on 'hold' legs: T+7d
  UNIQUE (ref, kind)                            -- layer-3 idempotency (see §3)
);

CREATE INDEX ledger_entries_account_ts ON ledger_entries (account_id, ts DESC);
CREATE INDEX ledger_entries_release    ON ledger_entries (release_at) WHERE kind = 'hold';

CREATE TABLE redemptions (
  id               TEXT PRIMARY KEY,            -- ULID
  account_id       TEXT NOT NULL REFERENCES accounts(id),
  amount_usd_micros BIGINT NOT NULL CHECK (amount_usd_micros >= 5000000), -- $5 min (see §6)
  rail             TEXT NOT NULL CHECK (rail IN ('giftcard','local_payout','usdc')),
  dest             TEXT NOT NULL,               -- masked dest (email/region for giftcard; addr for usdc)
  state            TEXT NOT NULL CHECK (state IN ('pending','submitted','fulfilled','failed','reversed')),
  provider_ref     TEXT,                        -- Tremendous order id / on-chain tx hash
  idempotency_key  TEXT NOT NULL UNIQUE,        -- client-supplied; prevents double redemption
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

> **Research correction:** the tech-spec ledger sketch listed a single `amount_usd_micros` with separate `debit_acct`/`credit_acct` columns. We refine to the pgledger model — one signed `delta` row **per leg**, grouped by `txn_id`, with a CI/nightly `SUM(delta)=0` check per transaction. This is the standard double-entry shape and what pgledger actually enforces.

### 2.3 Per-impression entries

Every *server-accepted* impression (green band; amber accrues at a discount; red accrues nothing — see [05-fraud-attestation.md](05-fraud-attestation.md)) mints one balanced transaction of three economic legs:

| Leg | kind | From → To | Amount |
|---|---|---|---|
| 1 | `ad_spend` | advertiser escrow → house | full per-impression price (block price ÷ 1000) |
| 2 | `imp_earn` | house → developer | **50%** of the impression price (matches incumbent split) |
| 3 | `hold` | developer (sub-account) → developer pending | the `imp_earn` amount, with `release_at = ts + 7 days` |

```text
txn(imp:<ref>):
  -P     advertiser_escrow   (ad_spend)
  +P     house               (ad_spend)
  -0.5P  house               (imp_earn)
  +0.5P  developer.available (imp_earn)
  -0.5P  developer.available (hold)        release_at = T+7d
  +0.5P  developer.pending   (hold)
  ──────────────────────────────────────
   0     (sums to zero)
```

- A matching `release` transaction at T+7d moves `developer.pending → developer.available`. The invariant check refuses any `release` without a prior matching `hold` (same `ref`).
- The 7-day rolling hold is the fraud settling window ([05-fraud-attestation.md](05-fraud-attestation.md)): a `fraud_clawback` can reverse a held `imp_earn` before release with no developer-visible "ban" feedback.
- `click_earn` is minted only from **server-attributed** clicks (the `/c/{code}` redirect, [03-protocol-SAP1.md](03-protocol-SAP1.md) §4.3), never from client `click_hint`. Clicks are a best-effort bonus signal, billed at 50× the impression price of the winning block.

> **Research correction:** impressions are batched into hourly `imp_earn` legs per device, not one DB transaction per impression. At 100k devices × 4k impressions/day the raw rate is ~4.6k events/s (trivial for ClickHouse), but the *ledger* writes are aggregated to ~tens of rows/s. Per-impression ledger rows would be wasteful and would worsen hot-account contention (§2.5).

### 2.4 Zero-sum invariant + CI check

The system holds money for nobody it cannot account for. Two enforcement layers:

```sql
-- Per-transaction balance (must always hold; checked on every mint via trigger).
CREATE FUNCTION assert_txn_balanced(p_txn TEXT) RETURNS void AS $$
BEGIN
  IF (SELECT COALESCE(SUM(delta_usd_micros),0) FROM ledger_entries WHERE txn_id = p_txn) <> 0 THEN
    RAISE EXCEPTION 'ledger txn % does not sum to zero', p_txn;
  END IF;
END; $$ LANGUAGE plpgsql;

-- Global invariant (nightly job + CI fixture): the whole ledger sums to zero.
SELECT CASE WHEN SUM(delta_usd_micros) = 0 THEN 'OK'
            ELSE 'LEDGER IMBALANCE' END AS ledger_health
FROM ledger_entries;

-- No release without a matching hold (same ref).
SELECT r.ref FROM ledger_entries r
LEFT JOIN ledger_entries h ON h.ref = r.ref AND h.kind = 'hold'
WHERE r.kind = 'release' AND h.ref IS NULL;   -- must return zero rows
```

CI runs these as a fixture-seeded gate (the ledger zero-sum nightly check is also a chaos test, see [08-testing-strategy.md](08-testing-strategy.md)). A non-zero global sum or an orphan `release` blocks release.

### 2.5 Hot-account sharding

`house`, advertiser-`escrow`, and the platform fee account are written on *every* impression transaction → they are serialization hot-spots under concurrency.

> **Research correction:** ledger hot-account contention and serialization under concurrency are explicitly called out as complexity hot-spots ([13-research-findings.md](13-research-findings.md) §G). Mitigate by sharding the house/escrow/platform accounts.

- Split each hot system account into `N` sub-shards: `house.00 … house.0F` (16 shards to start), chosen by `hash(device_id) % N`.
- Reads sum across shards (cheap, indexed). Writes hit one shard → contention drops ~N×.
- Hourly aggregation (§2.3) already collapses many impressions into one write, compounding the relief.
- Rebalance shards offline via balanced internal transfers if a shard skews.

---

## 3. Three-layer idempotency

A developer must never be paid twice for one impression; an advertiser must never be charged twice; a redemption must never fire twice. Enforced as **Postgres constraints with `ON CONFLICT DO NOTHING`**, not application-level checks.

| Layer | Constraint | Stops |
|---|---|---|
| 1 — event | `events_raw` ULID **unique index** (ingest) | duplicate delivery of the same SAP/1 event |
| 2 — chain | `UNIQUE(device_id, ctr)` on accepted events | replay / counter reuse per device ([03-protocol-SAP1.md](03-protocol-SAP1.md)) |
| 3 — ledger | `UNIQUE(ref, kind)` on `ledger_entries` | minting the same economic event twice |
| 4 — redemption | `UNIQUE(idempotency_key)` on `redemptions` | double payout from a retried `spnr redeem` |

```sql
-- Layer 3: minting is idempotent. A retried mint is a no-op.
INSERT INTO ledger_entries (id, txn_id, account_id, delta_usd_micros, balance_after_micros, kind, ref)
VALUES (...)
ON CONFLICT (ref, kind) DO NOTHING;
```

The `ref` is deterministic: `imp:<device_id>:<hour_bucket>:<creative_id>` for aggregated impression earnings, `click:<short_code>:<click_id>` for clicks, `redeem:<idempotency_key>` for redemptions. Same inputs → same `ref` → conflict → no double-credit.

---

## 4. Settlement rail (x402 / USDC on Base)

### 4.1 What x402 is

> **Research correction:** x402 is real and production-ready — an open standard under the **Linux Foundation x402 Foundation** (formed April 2, 2026), originated by **Coinbase + Cloudflare + Stripe**, 22 launch members incl. AWS, Google, Microsoft, Mastercard, Visa, Circle, Solana Foundation. This corrects any framing of x402 as speculative ([13-research-findings.md](13-research-findings.md) §D).

Flow: server returns `402 Payment Required` + `PaymentRequirements` → client signs a USDC transfer (EIP-3009 `transferWithAuthorization`, or Permit2 in V2) → a **facilitator** verifies and broadcasts on Base. ~200 ms typical settlement; ~$0.0001–$0.002 facilitator cost.

### 4.2 Rust stack

> **Research correction:** depend on the **component crates** `x402-axum` (server) and `x402-reqwest` (client), currently **v1.5.6** on crates.io — NOT the stale `x402-rs` umbrella crate at 0.12.5. Pin to a protocol version (V1 vs V2) explicitly.

| Concern | Crate / constant |
|---|---|
| x402 server (advertiser-funding `/v1/fund`, agent-buyer `/v1/bids`) | `x402-axum` v1.5.6 |
| x402 client (paying facilitators / agents paying us) | `x402-reqwest` v1.5.6 |
| Base / USDC contract calls | **`alloy-rs`** (not `ethers-rs`) |
| USDC on Base (contract address) | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| Confirmations before crediting | **2–3** confirmations |
| Depeg breaker | trip at **50 bps** oracle deviation; Chainlink USDC/USD on Base trips ~30 bps |

### 4.3 Batch settlement is mandatory — per-impression on-chain is impossible

> **Research correction (ADR-0003):** per-impression on-chain settlement is economically impossible — a Base tx costs ~$0.002–$0.02 while an impression is worth ~$0.000001–$0.00001 (the $1/block floor implies $0.001/impression). spnr **MUST aggregate impressions and settle developer payouts in batches** (hourly or threshold-based, e.g. ≥ $1–$5). See [adr/0003-x402-batch-settlement-not-per-impression.md](adr/0003-x402-batch-settlement-not-per-impression.md).

```text
real-time:   signed event → ingest → fraud band → ledger imp_earn (off-chain, USD micros)
hourly/≥$:   aggregate developer.available balances → on-chain USDC payout batch
on-chain:    advertiser funding (in)  and  developer USDC redemption (out) ONLY
```

The off-chain ledger is the source of truth and moves in real time; the chain is touched only at the funding boundary (advertiser → escrow) and the redemption boundary (escrow → developer wallet, the default USDC rail). Developers who take the fiat off-ramp (gift card / UPI / local payout) never touch the chain — for them it is invisible plumbing.

### 4.4 Custody — facilitators do NOT hold funds

> **Research correction:** x402 facilitators verify and broadcast; they do **not** custody funds. Advertiser prepaid budgets and developer payout balances are a **spnr-owned wallet / escrow / key-custody surface** — which carries the KYC/AML/money-transmission burden ([13-research-findings.md](13-research-findings.md) §D).

| Component | Design |
|---|---|
| Escrow | single segregated, **published on-chain escrow address** for auditability; advertiser funds never commingled with operating funds |
| Hot wallet | MPC/HSM-backed, **spend-capped**, services hourly payout batches; replenished from cold |
| Cold reserve | majority of reserves; manual/multi-sig movement only |
| Managed option | consider **Coinbase CDP managed wallets** or a custody provider to offload key-management risk |
| Peg safety | **dual-source** USDC peg (Chainlink + DEX TWAP); 50 bps breaker pauses funding + payouts with **explicit, published resume criteria** |

See [07-security-privacy.md](07-security-privacy.md) for the full key-custody threat model.

---

## 5. State machines

### 5.1 Earned balance lifecycle

```text
                impression accepted (green/amber)
   (none) ──────────────────────────────────────► PENDING (hold, release_at = T+7d)
                                                     │           │
                              fraud_clawback ◄───────┘           │ release_at reached
                                  (reversed)                     ▼
                                                              AVAILABLE
                                                                 │ spnr redeem (≥ $5)
                                                                 ▼
                                                             REDEEMING ──provider ack──► REDEEMED
                                                                 │ provider failure
                                                                 ▼
                                                            AVAILABLE (reversed, retryable)
```

### 5.2 Redemption lifecycle (mirrors `redemptions.state`)

```text
pending ──submit to provider──► submitted ──webhook: success──► fulfilled
   │                                │
   │ pre-submit validation fail     │ webhook: failure / timeout
   ▼                                ▼
 failed (balance restored)      failed (balance restored, idempotency_key retained)
```

A `failed` redemption restores the balance via a compensating `release`-style entry; the original `idempotency_key` is retained so a user retry with the same key is a no-op until they explicitly start a new redemption.

---

## 6. Redemption tiers

> **Research correction (ADR-0001):** the original spec's headline — "redeem as Anthropic/OpenAI **API credits** (default)" — is **refuted**. You cannot resell provider API credit codes: neither Anthropic nor OpenAI sells prepaid API-credit gift cards or runs a reseller/fulfillment API, and **OpenAI's Service Credit Terms explicitly prohibit transfer/sale/gift/trade of Service Credits** (violation → credit revocation **and** account termination). The wedge survives, reframed to gift cards. See [adr/0001-payout-default-gift-cards-not-api-credits.md](adr/0001-payout-default-gift-cards-not-api-credits.md).

### 6.1 Tier table

> **Wedge alignment (ADR-0006):** USDC over x402 is the **default** developer payout; the fiat off-ramp (gift cards / UPI / local payouts) is **opt-in**. This is the reverse of the earlier gift-card-default framing — see [adr/0006-crypto-native-agent-economy-launch-wedge.md](adr/0006-crypto-native-agent-economy-launch-wedge.md).

| Tier | Rail | Mechanism | Geography | Notes |
|---|---|---|---|---|
| **Default** | `usdc` | USDC over x402 to a user-supplied, test-tx-confirmed wallet (Base) | Global (wallet) | The crypto-native wedge. **Requires the MSB/MTL + crypto legal opinion and wallet/custody on the pre-launch critical path** (§7, header callout). India VDA/TDS notice surfaced in-flow. |
| **Off-ramp (opt-in)** | `giftcard` / `local_payout` | **Tremendous** aggregator API: gift cards + local bank/UPI/PayPal payouts | 200+ countries incl. **India** | For fiat-preferring or tax-sensitive devs (esp. India). Free at face value, sandbox available, no order minimums, ~1–2 business-day production approval. Surfaced one-tap as "no wallet? get paid in a gift card / UPI instead." |
| **Indirect "API credits"** | (any of the above) | Pay general-purpose value (Amazon / Visa prepaid / local gift card / USD) the dev uses to top up **their own** provider console | per chosen card | **Never mint or resell credit codes.** Disclosed as indirect. Official provider startup-credit programs are a future, gated, non-guaranteed perk. |
| **Never** | — | Vague points, watch-to-earn, crypto-as-marketing, reselling provider credit codes | — | Trust-destroying and/or ToS-violating. Out of scope. |

### 6.2 Default rail: USDC over x402 (Base)

The default payout is **USDC over x402 on Base** to a user-supplied, test-tx-confirmed wallet, settled in batches per §4.3 (per-impression on-chain is impossible; aggregate hourly / ≥ $1–$5). Balances stay USD-denominated in the ledger; USDC is the default settlement of that balance behind the depeg breaker (§5.4 / §4.2).

- This rail is what puts the **MSB/MTL + crypto legal opinion and the spnr-owned wallet / custody / escrow surface on the pre-launch critical path** (§4.4, §7, header callout) — designed for, not discovered late.
- KYC/AML and velocity limits attach above thresholds; the redemption flow is built to enforce them.
- India VDA/TDS disclosure is mandatory and surfaced in-flow (§7) — USDC receipt is taxed more heavily than the fiat off-ramp, which is precisely why the off-ramp is retained.
- Idempotent payout keyed by `redemptions.idempotency_key`; on-chain tx hash recorded in `provider_ref`; `redemptions.state = fulfilled` after 2–3 confirmations.

### 6.2a Off-ramp rail: Tremendous / Reloadly (opt-in fiat)

> **Research correction:** the fiat off-ramp is **"instant global gift-card and local-payout redemption via a battle-tested aggregator,"** not "API credit codes." Tremendous is the primary off-ramp vendor; **Tango Card** (225+ countries) and **Reloadly** (PIN vouchers) are evaluated as secondary/redundant rails ([13-research-findings.md](13-research-findings.md) §C). This rail is **opt-in**, not the default — it exists so wallet-less and tax-sensitive developers (notably in India) are not driven away (ADR-0006).

- The provider (a licensed reward-platform vendor) carries the gift-card / escheat / AML burden ([07-security-privacy.md](07-security-privacy.md), [12-risks-open-questions.md](12-risks-open-questions.md)).
- Idempotent order creation keyed by `redemptions.idempotency_key`; fulfillment confirmed by webhook → `redemptions.state = fulfilled`.
- Delivered in-CLI (`spnr redeem`) and by email; balance decremented atomically with the ledger `redeem` entry, only on provider ack.

### 6.3 The indirect "API credits" story (allowed, disclosed)

The only honest way to let a developer "pay for their Claude subscription" with earnings: pay them **general-purpose value** (a Visa/Amazon/local gift card, or USD) that *they* apply to *their own* provider console. spnr never holds, mints, resells, or brokers a provider credit code. Copy must say "use this gift card to top up your own account," never "redeem for API credits."

### 6.4 $5 minimum redemption threshold

> **Research correction:** "instant redemption per impression" is reframed — instant applies **once a $5 minimum is met**, not per impression. The $5 threshold clears gift-card minimums and fees; balances stay USD-denominated always.

The `redemptions.amount_usd_micros >= 5000000` CHECK enforces it at the DB. At ~$0.001/impression floor and a 50% dev split (~$0.0005/dev/impression), $5 is ~10,000 developer-credited impressions — a real but reachable threshold that keeps per-redemption fees sane.

---

## 7. Legal gating (pointers — informational, not legal advice)

These gates **block** enabling the relevant rail. Full detail in [07-security-privacy.md](07-security-privacy.md) and [12-risks-open-questions.md](12-risks-open-questions.md).

| Gate | Rule | Action before enabling |
|---|---|---|
| USDC = MSB/MTL exposure (**pre-launch critical path**) | USDC is "convertible virtual currency"; accepting + transmitting CVC generally makes you an **MSB / money transmitter** unless exempt → federal MSB registration + state MTL exposure | Because USDC is the **default** payout (ADR-0006), a real **money-services/MTL + crypto legal opinion is a v0.1 blocker** — it must clear, with wallet/custody built (§4.4), **before launch**, not as a later gate. This is the single biggest cost of the crypto-native wedge. |
| Fiat off-ramp (closed-loop) | FinCEN excludes closed-loop prepaid (31 CFR 1010.100(ff)(5)(ii)(E)); < **$2,000/day/user** also excluded from the prepaid-program BSA regime | For the opt-in fiat off-ramp: keep per-user daily redemption **< $2,000**; disburse via the licensed vendor (Tremendous/Tango/Reloadly) so the vendor carries gift-card/escheat/AML. |
| India tax copy | A user EARNING USDC likely owes **ordinary income tax at slab rates on receipt** (zero cost basis), THEN 30% (s.115BBH) + 1% TDS (s.194S) on later transfer/sale | USDC receipt is taxed more heavily than the fiat off-ramp — exactly why the off-ramp (UPI / Amazon-India / local) is retained and surfaced for Indian devs. The original "30% + 1% TDS" copy **understates** the income-on-receipt event; in-flow VDA/TDS disclosure is mandatory. Draft India tax copy with an Indian CA. |
| Earnings claims | FTC 16 CFR Part 255 disclosure; Business Opportunity Rule (16 CFR 437) + pending 2025 FTC earnings-claims rulemaking | Any "earn $X" figure needs written substantiation + "results not typical" qualifiers (advertising counsel). |

> **Wedge alignment (ADR-0006):** USDC is the **default** payout, so the money-services/MTL + crypto opinion is on the **pre-launch critical path** alongside the wallet/custody build — not deferred. This reverses the earlier "USDC is not a day-one feature / day one is gift-cards only" framing. The honest trade-off stands: USDC raises real MSB/MTL exposure and heavier India VDA/TDS friction, so the fiat off-ramp is kept first-class rather than hidden.

---

## 8. Open questions (tracked in [12-risks-open-questions.md](12-risks-open-questions.md))

- MSB/MTL + crypto legal opinion and wallet/custody readiness vs. the v0.1 launch date — now the **gating pre-launch dependency** because USDC is the default payout (ADR-0006, [14-go-no-go.md](14-go-no-go.md)).
- Custodial wallet (Coinbase CDP managed) vs. a minimal on-chain escrow contract — start custodial + published address; contract candidate for v1.0.
- Exact Tremendous production-approval timeline vs. the v0.1 launch date (the fiat off-ramp must be live at launch so wallet-less / tax-sensitive devs have a one-tap alternative).
- Whether to run Tango Card / Reloadly as a hot standby from day one or add post-launch.
- Per-region payout availability gaps within Tremendous's 200+ countries (confirm India bank-payout + gift-card SKUs before the India GTM push).
- Resume criteria wording for the depeg breaker (published constant).

---

*06-money-settlement.md ends — Draft v0.4, June 12, 2026. Wedge (ADR-0006): USDC over x402 is the default developer payout, with gift cards / UPI / local as the opt-in fiat off-ramp — never resold API credits. USDC-as-default puts the MSB/MTL + crypto opinion and wallet/custody on the pre-launch critical path.*
