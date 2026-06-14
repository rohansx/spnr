# spnr — Documentation

> **spnr** — the open, crypto-native, agent-economy ad network for terminal wait-states. Sponsored spinner
> text in Claude Code / Codex CLI, attested per-impression, settled natively over x402/USDC (Base) — with
> autonomous agents able to buy human attention. Developers paid in USDC by default; fiat (gift cards / UPI /
> local) is the off-ramp, not the default.
> Status: **planning / pre-implementation** · Draft v0.3 · June 12, 2026

This folder is the planning corpus produced from the two source specs, validated by deep research, and
reshaped where research corrected the original assumptions. **Start with the go/no-go.**

## Read in this order

1. **[14-go-no-go.md](14-go-no-go.md)** — the readiness call and the decisions needed before coding. *(start here)*
2. **[13-research-findings.md](13-research-findings.md)** — validated, adversarially-checked research with citations.
3. **[00-product-overview.md](00-product-overview.md)** — refined product overview (corrected positioning).
4. **[01-architecture.md](01-architecture.md)** — system architecture (client + backend, data flows, trust boundaries).
5. **[02-technical-spec.md](02-technical-spec.md)** — consolidated engineering spec (the integrating document).

## Deep dives

| Doc | Covers |
|---|---|
| [03-protocol-SAP1.md](03-protocol-SAP1.md) | SAP/1 event & attestation protocol (the published RFC) |
| [04-impression-engine.md](04-impression-engine.md) | How impressions are measured (signals, state machine, caps) |
| [05-fraud-attestation.md](05-fraud-attestation.md) | Anti-fraud + attestation (device identity, fraud bands) |
| [06-money-settlement.md](06-money-settlement.md) | Ledger, x402/USDC settlement, redemption (corrected wedge) |
| [07-security-privacy.md](07-security-privacy.md) | Threat model, content firewall, privacy posture |
| [08-testing-strategy.md](08-testing-strategy.md) | Editor-safety suite, replay harness, fraud sims, CI gates |
| [09-repo-build-layout.md](09-repo-build-layout.md) | Cargo workspace, crates, build/toolchain, verified deps |

## Plan & risk

| Doc | Covers |
|---|---|
| [10-implementation-plan.md](10-implementation-plan.md) | Phased build playbook with sequencing & dependencies |
| [11-phases-roadmap.md](11-phases-roadmap.md) | v0.1 → v1.0 + Phase 3, milestone acceptance criteria, go/no-go gates |
| [12-risks-open-questions.md](12-risks-open-questions.md) | Risk register + tracked open questions |
| [15-spike-results.md](15-spike-results.md) | v0.1 host-primitive spike results (S1–S4) — primary-source evidence |

## Decisions (ADRs)

| ADR | Decision |
|---|---|
| [0001](adr/0001-payout-default-gift-cards-not-api-credits.md) | No reselling API credit codes; gift cards/local rails are the payout mechanism (now the **fiat off-ramp** per ADR-0006) |
| [0002](adr/0002-statusline-as-coarse-liveness-gate.md) | statusline is a coarse liveness gate, not a per-frame heartbeat |
| [0003](adr/0003-x402-batch-settlement-not-per-impression.md) | Settle payouts in aggregated batches, not per-impression on-chain |
| [0004](adr/0004-platform-risk-adapter-abstraction.md) | Treat platform risk as existential; isolate behind HostAdapter |
| [0005](adr/0005-naming-and-domains.md) | Naming & domain registration plan |
| [0006](adr/0006-crypto-native-agent-economy-launch-wedge.md) | Crypto-native / agent-economy is the launch wedge |
| [0007](adr/0007-language-split-rust-client-ts-backend.md) | Language split: Rust client + Rust verifier/ledger/redirector; TypeScript web frontend + v0.2 portal/auction/payments (calls the Rust verifier, never a second crypto codepath) |
| [0008](adr/0008-frontend-react-ts-spa.md) | Frontend is a Vite + React + TypeScript SPA (design exports migrated off the dc-runtime) |

## Source (preserved verbatim)

- [source/product-spec-v0.2.md](source/product-spec-v0.2.md) — original product overview (as authored).
- [source/tech-spec-v1.0.md](source/tech-spec-v1.0.md) — original engineering spec (as authored).

> Where a refined doc and a source spec disagree, the **refined doc wins** — research corrected three
> load-bearing claims (the API-credits wedge, the statusline heartbeat, and domain/namespace ownership).
> See the go/no-go for the summary.

## The six invariants (every doc respects these)

1. Never degrade the editor/CLI. 2. Never read work product. 3. Undercount, never overcount.
4. Machine honest until proven otherwise; network assumes every client is hostile. 5. Everything on the user's
machine is open source and reproducible. 6. Fail quiet, fail stock.
