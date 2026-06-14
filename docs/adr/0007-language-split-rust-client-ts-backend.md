# ADR 0007 — Language split: Rust client + Rust verifier/ledger/redirector, TypeScript portal/auction/payments

> Status: **Accepted** · 2026-06-13
> Related: [ADR 0003 — batch settlement](0003-x402-batch-settlement-not-per-impression.md) · [ADR 0004 — platform risk](0004-platform-risk-adapter-abstraction.md) · [ADR 0006 — crypto-native wedge](0006-crypto-native-agent-economy-launch-wedge.md) · [01-architecture.md](../01-architecture.md) · [09-repo-build-layout.md](../09-repo-build-layout.md) · [11-phases-roadmap.md](../11-phases-roadmap.md) · [14-go-no-go.md](../14-go-no-go.md)

## Context

The system has two very different surfaces with different change profiles:

- **Hot, correctness/latency-critical, security-load-bearing code** — the client hot path (`spnr-hook`, `spnr-status`), the daemon (`spnrd`), the user CLI (`spnr`), the SAP/1 wire types/signing (`spnr-proto`), and the server-side **ingest verifier + ledger + redirector**. These carry hard latency budgets (hot-path exit ≤ 50 ms / ≤ 10 ms, redirector p99 < 50 ms), an append-only double-entry ledger that is the economic system of record, and the Ed25519/BLAKE3 attestation verification that establishes economic truth (invariants 1, 3, 4, 5).
- **CRUD-shaped, fast-iterating product surface** — the web frontend (marketing site, dashboards) and, from v0.2, the advertiser self-serve portal + auction-facing API + payments/fulfillment API. These change often, are network-bound not CPU-bound, and benefit from a large library ecosystem and fast feedback loops.

A single-language choice forces a bad trade either way: all-Rust slows iteration on the portal/CRUD surface, while all-TypeScript would require re-implementing the SAP/1 verifier (a **second Ed25519/BLAKE3 codepath**) and would put a heavier runtime on latency-critical hot paths. The verifier in particular must never be duplicated: two crypto implementations is two places for a signature-verification bug to diverge, and divergence here is a direct revenue-integrity and fraud-surface risk.

## Decision

1. **Client = Rust.** The daemon (`spnrd`), hot-path binaries (`spnr-hook`, `spnr-status`), the user CLI (`spnr`), and the shared SAP/1 wire layer (`spnr-proto`) are Rust — as already specified in [09-repo-build-layout.md](../09-repo-build-layout.md) and [01-architecture.md](../01-architecture.md).
2. **Verifier + ledger + redirector = Rust (`spnr-server`).** The ingest verifier (signature → counter monotonicity → chain continuity → ULID dedup → caps), the double-entry ledger, and the latency-critical `/c/{code}` redirector stay Rust. The verifier **reuses `spnr-proto`** for Ed25519 signing and BLAKE3 chaining — **ONE crypto codepath shared between client and server**. There is never a second crypto implementation.
3. **Web frontend + v0.2 portal/auction/payments = TypeScript (`server-ts/`).** The web frontend (`web/`, Vite) and the v0.2 advertiser portal + auction-facing API + payments/fulfillment API live in TypeScript. They **call the Rust verifier rather than reimplementing it** — verification and ledger writes cross into the Rust `spnr-server` surface; the TS tier owns the CRUD/portal/payments product surface only.

## Consequences

- 🟢 **Fast iteration on the CRUD/portal/payments surface.** The advertiser portal, auction-facing API, and payments/fulfillment API ship and change on the TypeScript ecosystem's velocity, where the work is glue/CRUD/integration rather than hot-path or crypto.
- 🟢 **Correctness/latency-critical pieces stay Rust.** Hot-path binaries, the ledger, the redirector, and the SAP/1 verifier keep their existing latency budgets, memory profile, and the editor-safety/content-firewall invariants — no GC pause or runtime startup cost on paths that cannot afford it.
- 🟢 **ONE crypto codepath.** `spnr-proto` is the single Ed25519/BLAKE3 implementation, shared client↔server. The TS tier never touches signing/verification directly; it calls the Rust verifier. No dual crypto implementation to keep in sync, no second place for a verification bug to hide.
- 🟠 **A language boundary between `server-ts/` and `spnr-server`.** The TS portal/payments tier calls the Rust verifier/ledger across a process/service boundary; that contract (request/response shape) must be kept stable and tested. This is a deliberate, well-defined seam, not incidental coupling.
- ⚪ **Unchanged:** the Rust workspace layout and per-crate responsibilities ([09-repo-build-layout.md](../09-repo-build-layout.md)); the trust boundaries and data flows ([01-architecture.md](../01-architecture.md)); batch settlement ([ADR-0003](0003-x402-batch-settlement-not-per-impression.md)) and the platform-risk adapter abstraction ([ADR-0004](0004-platform-risk-adapter-abstraction.md)).
- 🔴 **v0.1 ships on the Rust thin-verifier — do NOT rewrite it.** The v0.1 verifier/ledger/redirector are Rust and stay Rust. The TypeScript tier is additive (v0.2 portal/auction/payments); it does not replace or re-implement any v0.1 Rust component.

## Alternatives considered

- **All-Rust (rejected):** keeps a single language, but slows iteration on the portal/CRUD/payments surface where Rust's strengths (zero-cost abstractions, no GC, memory safety) buy little and its slower feedback loop costs the most. Rejected as the choice for the fast-moving product surface, retained everywhere correctness/latency matters.
- **All-TypeScript (rejected):** would force a **second Ed25519/BLAKE3 verifier codepath** (dual crypto implementation — a revenue-integrity and fraud risk) and put a heavier runtime with startup/GC cost on the latency-critical hot paths (hot-path binaries, redirector). Rejected.

## Impact on other docs

[09-repo-build-layout.md](../09-repo-build-layout.md) (an "Implementation languages" note recording the split), [11-phases-roadmap.md](../11-phases-roadmap.md) (a v0.2 "TypeScript portal/auction API (`server-ts/`)" scope bullet), [01-architecture.md](../01-architecture.md) (backend services), and [14-go-no-go.md](../14-go-no-go.md) (v0.1 stays on the Rust thin-verifier) are consistent with this decision.
