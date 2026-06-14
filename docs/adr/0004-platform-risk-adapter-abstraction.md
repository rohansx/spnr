# ADR 0004 — Treat Platform Risk as Existential, Isolate it Behind a `HostAdapter` Abstraction

> Why spnr never binds its survival to a single host surface: a `HostAdapter` trait turns a `spinnerVerbs` deprecation or a discretionary Anthropic shutdown into a graceful degradation, not an outage — and a set of hard self-imposed constraints keeps spnr out of the enforcement category that actually got harnesses banned.
> Status: Draft v0.3 · June 12, 2026

---

## Status

**Accepted** — supersedes the source spec's framing in two ways:
1. Downgrades the existential *probability* (the "Anthropic will likely ban this" read does not hold; see Context).
2. Keeps the existential *architecture* (platform risk is still treated as fatal-if-unmitigated; two real risks survive).

Related: [adr/0002-statusline-as-coarse-liveness-gate.md](0002-statusline-as-coarse-liveness-gate.md) (the fallback surface), [adr/0001-payout-default-gift-cards-not-api-credits.md](0001-payout-default-gift-cards-not-api-credits.md) (the disclosure/legal posture), [adr/0005-naming-and-domains.md](0005-naming-and-domains.md) (anti-phishing posture), [12-risks-open-questions.md](../12-risks-open-questions.md) (risk register), [13-research-findings.md](../13-research-findings.md) (citations).

---

## Context

The source product spec (`../source/product-spec-v0.2.md` §2.3, §7) and tech spec (`../source/tech-spec-v1.0.md` §2.4, §11) both flagged platform risk as existential and assumed Anthropic would *likely* shut spnr down. Research refined this.

### What actually got banned (Jan–Apr 2026 crackdown)

> **Research correction:** The harsh "Anthropic will likely shut this down" read does **not** hold. Anthropic's Jan–Apr 2026 enforcement targeted third-party harnesses that **exported OAuth subscription tokens and spoofed the official client to route Claude model requests** (billing / rate-limit arbitrage). That precedent does **not** transfer to spnr. See [13-research-findings.md](../13-research-findings.md) §B.

spnr does none of the banned behaviors:

| Banned harness behavior (the crackdown target)        | spnr's behavior                                                       |
|-------------------------------------------------------|-----------------------------------------------------------------------|
| Export OAuth subscription tokens                      | Never touches OAuth tokens; auth is spnr's own account (GitHub device flow / magic link) |
| Spoof the official client to route model requests     | Uses the **unmodified official binary**; routes **no** model requests |
| Billing / rate-limit arbitrage against Anthropic      | No interaction with Anthropic billing or rate limits at all           |
| Suppress / spoof host telemetry to evade detection    | Never suppresses or spoofs host telemetry or heartbeats (was a detection trigger) |
| spnr's only host mutation                             | Edits the local `spinnerVerbs` **display** setting in `~/.claude/settings.json` |

The category spnr lives in — editing a documented-ish *local display setting* — is materially different from the request-routing harnesses that were enforced against.

### The two real risks that survive (still treated as existential in the architecture)

1. **Surface continuity.** `spinnerVerbs` is fragile and possibly-undocumented.

   > **Research correction:** Research streams disagree on `spinnerVerbs`' documentation status — one found it documented at `code.claude.com/docs/en/settings.md` with shape `{ "mode": "replace"|"append", "verbs": [...] }`; another found it described as undocumented / informally shipped (ref `anthropics/claude-code` issue #21599). Treat it as a **fragile surface Anthropic can remove or gate in a single release with no deprecation guarantee.** See [13-research-findings.md](../13-research-findings.md) §A.

2. **Discretionary brand / PR shutdown.** Independent of any ToS violation, Anthropic can kill a visible third-party spinner-ad network for optics.

   > **Research correction:** Anthropic publicly committed (Feb 2026, Super Bowl LX, "Claude is a space to think") to keeping Claude ad-free — "no sponsored links," "no third-party product placements our users did not ask for." A visible third-party spinner-ad network is a discretionary PR target regardless of technical compliance. See [13-research-findings.md](../13-research-findings.md) §B.

### Risk re-rating

| Risk                              | Source-spec read           | Corrected read                                  | Mitigation                                  |
|-----------------------------------|----------------------------|-------------------------------------------------|---------------------------------------------|
| ToS-enforcement ban (token/routing) | High / "likely"          | **Low** — wrong category; precedent doesn't transfer | Hard constraints below (stay out of category) |
| `spinnerVerbs` removed / gated    | Existential               | **Medium-high, one-release-notice** continuity risk | `HostAdapter` trait → statusline-only fallback |
| Discretionary brand/PR shutdown   | Implicit                  | **Medium, unbounded-timing** discretionary risk  | Clear sponsored disclosure; low burn; monitor Kickbacks.ai |

The conclusion is *not* "relax." It is: **platform risk is still existential, but the failure mode shifted from "banned for what we do" to "the surface evaporates underneath us."** The architectural answer to a vanishing surface is an adapter abstraction; the answer to discretionary shutdown is good behavior plus low burn plus a non-stranding exit.

---

## Decision

### D1 — `HostAdapter` trait isolates every host-specific assumption

All host coupling lives behind one trait (from `../source/tech-spec-v1.0.md` §2.4):

```rust
trait HostAdapter {
    /// Inject sponsored verbs / register surfaces. Idempotent.
    fn inject(&self) -> Result<(), AdapterError>;
    /// Restore stock config. Idempotent; safe to call from any spnr binary.
    fn restore(&self) -> Result<(), AdapterError>;
    /// Which event sources this host exposes (hooks, statusline, …).
    fn event_source(&self) -> EventSource;
    /// Which surfaces are currently usable on this host, runtime-probed.
    fn capabilities(&self) -> HostCapabilities;
}

bitflags! {
    struct HostCapabilities: u8 {
        const SPINNER          = 0b0001; // spinnerVerbs writable + honored
        const STATUSLINE       = 0b0010; // statusLine command surface (clicks + liveness)
        const HOOK_EVENTS      = 0b0100; // SessionStart/Stop/PreToolUse/... fire
        const TTY_ATTESTATION  = 0b1000; // controlling-terminal check available
    }
}
```

Planned implementations and rollout:

| Adapter          | Version | Surfaces relied on                          | Notes                                              |
|------------------|---------|---------------------------------------------|----------------------------------------------------|
| `claude_code_cli`| v0.1    | spinner + statusline + hooks + TTY          | Primary. Detects project-level `spinnerVerbs` override and serves no impressions there (don't fight the user's config). |
| `codex_cli`      | v0.2    | host-specific (probe at startup)            | Second host; proves the abstraction isn't single-host. |
| `vscode`         | v0.3    | thin wrapper around the same daemon socket  | One brain, many surfaces; statusline-equivalent only if host lacks a spinner surface. |

### D2 — Degradation ladder (a surface loss is a mode change, not an outage)

The capability flags drive a deterministic degradation ladder. Loss of `SPINNER` is the headline continuity event from D1's two risks.

```
FULL ──spinnerVerbs removed/gated/project-override──► STATUSLINE_ONLY
FULL ──statusLine regresses (OSC-8 strip, #43826)───► SPINNER_ONLY (impression-only, no clicks)
either ──both surfaces gone OR killswitch──────────► DORMANT (stock config, accrual paused, balances intact)
```

| Mode             | Spinner | Statusline | Earns?            | Editor impact | Trigger                                            |
|------------------|---------|------------|-------------------|---------------|----------------------------------------------------|
| `FULL`           | yes     | yes        | impressions + clicks | zero       | all capabilities present                           |
| `STATUSLINE_ONLY`| no      | yes        | reduced (no spinner inventory) | zero | `spinnerVerbs` removed / gated / project override  |
| `SPINNER_ONLY`   | yes     | no         | impressions only  | zero          | statusline regression (see [adr/0002](0002-statusline-as-coarse-liveness-gate.md)) |
| `DORMANT`        | no      | no         | nothing accrues; **balances preserved** | zero | both surfaces gone, or signed killswitch fires     |

The key property (Invariant 1, *never degrade the editor/CLI*): every transition restores stock config first, then re-injects only what the host still honors. A `spinnerVerbs` deprecation upstream is "spinner adapter disabled fleet-wide; statusline-only mode" — a **product decision, not an outage** (matches `../source/tech-spec-v1.0.md` §11).

### D3 — Hard constraints (stay permanently out of the enforcement category)

These are CI-checkable invariants of the client, not guidelines. They keep spnr in the "edits a local display setting" category, never the "request-routing harness" category that got banned.

| # | Hard constraint                                                | Enforcement                                                                 |
|---|----------------------------------------------------------------|-----------------------------------------------------------------------------|
| 1 | **Official binary only.** Never patch, wrap, or repackage the host binary. | spnr ships no host binary; installer touches only `~/.claude/settings.json` + spnr's own files. |
| 2 | **Never export OAuth tokens.** spnr never reads the host's OAuth/subscription tokens. | Content firewall (`../source/tech-spec-v1.0.md` §10.2); egress canary asserts host token material never leaves the machine. |
| 3 | **Never route model requests.** spnr sends zero traffic to Anthropic/OpenAI inference endpoints. | Egress allow-list = `*.spnr.sh` / `*.spnr.co` / facilitator endpoints only; CI egress-canary test fails on any other host. |
| 4 | **Never suppress or spoof host telemetry / heartbeats.** (This was a crackdown detection trigger.) | spnr writes only its own keys; it never deletes, rewrites, or fabricates host telemetry config or heartbeat data. |
| 5 | **Clear sponsored disclosure.** Sponsored verbs carry a brand-name lint; statusline labels spnr; copy is FTC-disclosable. | Creative lint requires brand name (`../source/tech-spec-v1.0.md` §2.1); see [adr/0001](0001-payout-default-gift-cards-not-api-credits.md) for FTC 16 CFR Part 255 disclosure. |
| 6 | **Never strand accrued balances** if a surface vanishes. | `DORMANT` mode preserves USD-denominated balances; redemption rail stays live independent of host surface (see [06-money-settlement.md](../06-money-settlement.md)). |

### D4 — Highest-signal external gate: Anthropic's reaction to Kickbacks.ai

Kickbacks.ai (launched June 11, 2026) is the same-category incumbent — it also replaces `spinnerVerbs` and is openly an ad network. **Anthropic's first public/enforcement reaction to Kickbacks.ai is the single highest-signal data point for spnr's discretionary-shutdown risk**, and it costs spnr nothing to observe. Treat it as a gate on burn escalation:

```
observe Kickbacks.ai status
 ├─ Anthropic stays silent / tolerant ──► proceed; keep burn low, keep constraints
 ├─ Anthropic issues guidance / gating ──► adopt guidance immediately; pre-stage STATUSLINE_ONLY
 └─ Anthropic enforces against Kickbacks ─► assume spinner surface is closing; ship DORMANT-safe exit,
                                            lean on statusline + reusable moat libraries
```

### D5 — Keep burn low; non-stranding exit

- Keep fixed cost low enough that the discretionary-shutdown risk (unbounded timing) never threatens solvency mid-runway.
- Build the moat pieces (attestation, x402 settlement, ledger) as **reusable libraries**, not app-only code, so a category collapse has salvage value (`../source/product-spec-v0.2.md` §7.5).
- The exit plan when a surface vanishes: transition to `DORMANT`, keep the redemption rail live, let users redeem accrued balances down to the $5 threshold; never zero a balance because a host setting disappeared.

---

## Consequences

### Positive

- **Survives surface removal.** A `spinnerVerbs` deprecation degrades to `STATUSLINE_ONLY`, not an outage; the daemon, ledger, and redemption rail are unaffected.
- **Bounded blast radius.** Host coupling is confined to one trait + its implementations; the impression engine, protocol (SAP/1), and money layer never import host specifics.
- **Stays out of the enforced category.** The D3 constraints are exactly the behaviors the crackdown punished; CI-enforcing their *absence* is a durable defense.
- **Cheap, high-signal monitoring.** D4 converts an unbounded discretionary risk into an observable trigger by free-riding on the incumbent.
- **Multi-host from day two.** The `codex_cli` adapter (v0.2) forces the abstraction honest before VS Code (v0.3).

### Negative / costs

- **Earnings loss in fallback modes.** `STATUSLINE_ONLY` loses the spinner inventory (the larger surface); `SPINNER_ONLY` loses click revenue. This is accepted: clicks are already a best-effort bonus, not core revenue (see [adr/0002](0002-statusline-as-coarse-liveness-gate.md)).
- **Abstraction tax.** Every new surface must be expressible as `inject/restore/event_source/capabilities`; surfaces that don't fit (e.g., a future DOM surface) need the trait extended or a sibling trait.
- **Runtime capability probing adds startup work** in the daemon (acceptable; off the hot path — `spnr-hook`/`spnr-status` never probe).
- **Discretionary risk is not eliminated, only managed.** No abstraction defends against Anthropic deciding the category is unwelcome; D3/D4/D5 reduce probability and blast radius, they don't zero the risk. Tracked in [12-risks-open-questions.md](../12-risks-open-questions.md).

---

## Alternatives considered

### Alt 1 — Seek an explicit Anthropic partnership first

Pursue a sanctioned integration / partnership before shipping.

- **Pro:** removes discretionary-shutdown risk entirely; legitimizes the category.
- **Con:** slow (months), gated, and very likely declined given the Feb 2026 ad-free commitment. Blocks the 2–3-week launch window the category demands. **Rejected as a blocker**, retained as a non-guaranteed future track (parallel to the gated startup-credit program path in [adr/0001](0001-payout-default-gift-cards-not-api-credits.md)).

### Alt 2 — Pivot off `spinnerVerbs` entirely (statusline-only from day one)

Never touch the spinner; ship `STATUSLINE_ONLY` as the only mode.

- **Pro:** sidesteps the fragile/undocumented surface and most brand-optics exposure (no sponsored *spinner*).
- **Con:** **loses the core inventory** — the spinner is "the most-watched line on Earth" and the entire wedge. Statusline alone is a much smaller surface with its own fragility (OSC-8 strip regressions, issue #43826). **Rejected**: this throws away the asset to avoid a risk the adapter ladder already bounds. `STATUSLINE_ONLY` is correct as a *fallback*, wrong as the *default*.

### Alt 3 — No abstraction; hardcode the Claude Code CLI integration

Ship the fastest single-host path and deal with deprecation if/when it happens.

- **Pro:** least code, fastest v0.1.
- **Con:** a single `spinnerVerbs` removal becomes a total outage with no graceful path, and adding Codex/VS Code later means a risky rewrite. **Rejected** — the corrected risk rating (Medium-high, one-release-notice surface continuity) makes the abstraction's cost obviously worth paying.

---

*ADR 0004 ends — Draft v0.3, June 12, 2026.*
