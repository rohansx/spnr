# spnr — Research Findings & Spec Validation

> Purpose: the validated, adversarially-checked research that the rest of the docs are built on.
> Status: Draft v0.3 · June 12, 2026 · Method: 14 parallel research streams, 6 with adversarial refutation passes; key host facts cross-checked against Claude Code 2.1.175 running locally.

## How to read this

Each dimension carries a **verdict** (`supports` / `partially-supports` / `contradicts` / `inconclusive`)
and an assumption-by-assumption status (`confirmed` / `refuted` / `uncertain`). The load-bearing claims
were then handed to a second agent told to *refute* them; that result is the **adversarial check**.

Legend: ✅ confirmed · ⚠️ partially / uncertain · ❌ refuted.

---

## Scorecard

| # | Dimension | Verdict | Bottom line |
|---|---|---|---|
| 1 | `spinnerVerbs` setting | ⚠️ partially | Real, but `{mode,verbs}` object (not array); read-at-startup design is safe; **possibly undocumented & removable** |
| 2 | Hooks system | ⚠️ partially | Events real; **`Stop` not guaranteed once-per-turn**; don't trust hook timestamps; latency not free |
| 3 | `statusLine` "render heartbeat" | ❌ contradicts | **Not per-frame** (msg-boundary + ~300 ms debounce); buggy; headless never fires (good). Reframe to coarse gate |
| 4 | Plugin distribution (Path B) | ⚠️ partially | Works via SessionStart bootstrap; no install-time exec; marketplace friction possible |
| 5 | Anthropic ToS / platform risk | ⚠️ gray area | **Downgraded** from "likely shutdown" → unadjudicated gray area; real risks = surface removal + brand/PR |
| 6 | x402 protocol | ✅ supports | Real, LF-governed, production Rust crates; **must batch** (per-impression on-chain impossible) |
| 7 | USDC on Base | ✅ supports | Fees negligible, hourly batch viable, 50 bps breaker sound; custody + MT are the real risks |
| 8 | **Credits redemption wedge** | ❌ contradicts | **Cannot resell API credit codes.** Reframe to gift cards via Tremendous |
| 9 | Rust client deps | ⚠️ partially | Crates exist; **keys NOT non-exportable**; `self_update`≠minisign; <1 MB ambitious |
| 10 | Rust backend stack | ✅ supports | axum/sqlx/redis/ClickHouse mature; `pgledger` near-exact ledger; scale conservative |
| 11 | OSC 8 click surface | ⚠️ partially | Works in statusline (not spinner); fragile in CC/tmux; clicks are a bonus, not core revenue |
| 12 | Kickbacks.ai (incumbent) | ⚠️ partially | Mechanics confirmed; "614K / overwhelmingly positive" overstated; payouts not live |
| 13 | Legal / regulatory | ⚠️ partially | Closed-loop credits low-risk; USDC = MSB exposure; India tax understated; FTC disclosure required |
| 14 | Namespaces & domains | ⚠️ partially | crates free; **GitHub `spnr` taken (user); spnr.sh/.co UNREGISTERED; .dev unknown owner; .com squat** |

**Net:** the architecture is sound and buildable; **three claims required reshaping** the product before build:
the API-credits wedge (→ gift cards), the statusline heartbeat (→ coarse gate + server fraud scoring), and the
domain/namespace ownership (→ register now). Platform risk is real but narrower than first feared.

---

## 1. `spinnerVerbs` (host primitive) — ⚠️ partially-supports

- ✅ Real, documented setting in `~/.claude/settings.json`; format is an **object** `{ "mode": "replace"|"append", "verbs": [...] }` — **not** a bare array as some mental models assume. Source: code.claude.com/docs/en/settings.md.
- ✅ Scope precedence **Managed > Local > Project > User** → ❌ refutes the spec's "global-only, project can't override." v1 must detect a project-level override and serve no impressions there.
- ⚠️ Hot-reload: evidence mixed (may reload mid-session on CLI; contested on IDE). The spec's **read-at-startup + rotate-on-SessionStart + session-attribution** design is safe either way — keep it; treat hot-reload as a non-load-bearing bonus.
- ⚠️ No documented hard char limit (spec's ≤48 is self-imposed — keep). Plain-text only; **no evidence it accepts OSC 8 / ANSI** (see §11).
- **Adversarial check (❌ holds=false on "hot-reload enables mid-session rotation"):** don't build on mid-session rotation. *Already mitigated by the session-attribution design.*
- **Discrepancy to resolve:** stream 1 found it documented; streams 5 & 11 found it described as **undocumented / informally shipped** (anthropics/claude-code #21599) and removable in one release. → Treat `spinnerVerbs` as a **fragile surface Anthropic can remove at will** (core continuity risk; see §5, ADR-0004). Verify exact doc status by direct test.

## 2. Hooks — ⚠️ partially-supports

- ✅ The 7 events used exist (subset of 26+). ✅ A hook can be a fast fire-and-forget forwarder.
- ❌ **`Stop` is not guaranteed to fire exactly once per `UserPromptSubmit`** (interrupts/errors/blocking hooks drop it). → wait-interval close must also timeout-close; the ≤60-impressions/interval cap already bounds this.
- ❌ **Don't trust hook-supplied timestamps** (inconsistent across versions) — stamp on daemon receipt.
- ❌ **Fire-and-forget is not latency-free** (~200 ms observed in some setups). The `spnr-hook` datagram-and-exit design is right, but **benchmark real end-to-end hook latency** before default-on (spike S2).
- ⚠️ `UserPromptSubmit → Stop` bracketing of the spinner is plausible but **not explicitly guaranteed** — verify in real sessions. Users can `disableAllHooks` (plan for silent opt-out). Exit-code-2 blocking doesn't apply to PostToolUse; hooks must exit 0.

## 3. `statusLine` "render heartbeat" — ❌ contradicts (the biggest correction)

- ✅ **Good news, confirmed:** headless `claude -p` / non-interactive runs do **not** invoke statusLine → headless earns nothing. The cheapest strong anti-fraud rule survives.
- ❌ statusLine is **not per-frame** — it fires on **message boundaries with ~300 ms debounce**. "Each invocation == one human-visible paint" is too strong.
- ❌ **No frame-level timestamp** in the statusLine JSON → cannot build frame-granular device-signed render attestation.
- ⚠️ **Known bugs:** statusLine can stop updating mid-session after the first response (issue #43826); OSC-8-stripping regressions (v2.1.3 / v2.1.42 era).
- **Adversarial check (❌ holds=false, high confidence):** "statusLine cadence proves human-visible renders" does not hold as a sole signal.
- **Reframe → ADR-0002:** treat statusLine as a **coarse liveness gate** that confirms a human-visible TUI painted *recently*, gating seconds inside hook-derived WAITING intervals; set the gate window from an **empirically measured cadence constant** (spike S3); make **server-side fraud scoring** (timing distributions) the real moat. Advertiser claim = "attested + anomaly-filtered," never "viewability-grade." This is undercount-safe (invariant 3).
- **Spike S3 update (RESCUED) — see [15-spike-results.md](15-spike-results.md):** docs confirm the message-boundary + ~300 ms debounce cadence, **but** `statusLine.refreshInterval: 1` re-runs the command on a **~1 Hz wall-clock timer**, giving the per-second liveness tick the gate needs. The tick is a timer (proves a mounted TUI, not a watching human) → presence-damping still required. Also confirmed by spikes: `Stop` fires once-per-turn (bracketing more solid than feared); hook payloads carry **no timestamp** (daemon stamps); OSC 8 is **officially supported** in statusline.

## 4. Plugin distribution (Path B) — ⚠️ partially-supports

- ✅ A single plugin can register hooks, contribute a statusline command, and bootstrap an external daemon — but bootstrap happens via a **SessionStart hook on first run**, ❌ **not** at install time (no arbitrary install-time code exec). Use `${CLAUDE_PLUGIN_ROOT}` / `${CLAUDE_PLUGIN_DATA}`; degrade gracefully if the daemon is slow/absent.
- ⚠️ Official-marketplace submission may face friction if Anthropic deems ad-monetization controversial; community marketplace is a faster fallback. ✅ Plugin updates are automatic.

## 5. Anthropic ToS / platform risk — ⚠️ unadjudicated gray area (downgraded)

- The first stream read this as **contradicts / "likely shutdown"** citing the Jan–Apr 2026 third-party-harness crackdown.
- **Adversarial check (❌ holds=false, medium confidence) reversed the harsh read:** that crackdown targeted tools that **exported OAuth subscription tokens and spoofed the official client to route Claude requests** (billing/rate-limit arbitrage). **spnr does none of that** — official binary, no token export, no request routing; it only edits the local `spinnerVerbs` display setting. The precedent does not transfer.
- **Real surviving risks (still treat as existential in architecture):** (1) **surface continuity** — `spinnerVerbs` is fragile/possibly-undocumented (#21599) and removable in one release; (2) **discretionary brand/PR shutdown** — Anthropic's Feb 2026 "ad-free" commitments (Super Bowl LX, "Claude is a space to think": no sponsored links, "no third-party product placements our users did not ask for").
- **Hard constraints (ADR-0004):** official binary only; never export OAuth tokens; never route model requests; **never suppress/spoof host telemetry or heartbeats** (that *was* a detection trigger); clear sponsored disclosure; monitor Anthropic's first reaction to Kickbacks.ai (highest-signal datapoint); low burn; never strand accrued balances.

## 6. x402 protocol — ✅ supports

- ✅ Real open standard under the **Linux Foundation x402 Foundation** (formed April 2, 2026), originated by **Coinbase + Cloudflare + Stripe** (credit all three), 22 launch members (AWS, Google, Microsoft, Mastercard, Visa, Stripe, Circle, Solana). Flow: 402 + PaymentRequirements → client signs USDC transfer (EIP-3009 `transferWithAuthorization`; Permit2 in V2) → facilitator verifies + broadcasts on Base. ~200 ms, ~$0.0001–$0.002.
- ✅ Production Rust: **component crates `x402-axum` + `x402-reqwest` v1.5.6** on crates.io (use these, not the stale `x402-rs` 0.12.5 umbrella). ✅ The `POST /v1/bids → 402` agent-buyer pattern is x402's flagship use.
- ⚠️ **Adversarial check (✅ holds=true, high confidence) with one hard constraint:** **per-impression on-chain settlement is impossible** (Base tx $0.002–$0.02 ≫ impression $0.000001–$0.00001) → **aggregate + batch** developer payouts (ADR-0003). Facilitators **don't custody** → spnr owns escrow/key custody (security + MT burden).

## 7. USDC on Base — ✅ supports

- ✅ Base fees ~$0.002/tx, ~200 ms; hourly batch amortizes gas; 50 bps depeg breaker is conservative (Chainlink USDC/USD on Base trips ~30 bps). ✅ Rust via **alloy-rs**; USDC = `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`; 2–3 confs.
- ⚠️ Real risks operational/regulatory: hot-wallet custody (MPC/HSM, spend-capped + cold reserve), sequencer/RPC dependence, and **unsettled money-transmission status** for USDC rewards (gate behind counsel).

## 8. Credits redemption wedge — ❌ contradicts (reframe required)

- ❌ **You cannot resell Anthropic/OpenAI API credit codes.** No provider reseller/fulfillment API or prepaid API-credit gift card exists. **OpenAI Service Credit Terms explicitly prohibit transfers/sales/gifts/trades** of credits → revocation + account termination. Provider "redeem promotional credit" paths are gated programs only.
- **Adversarial check (✅ holds=true, high confidence):** the refutation stands.
- **Reframe → ADR-0001:** day-one wedge = **"instant global gift-card & local-payout redemption via Tremendous"** (free at face value, sandbox, 200+ countries incl. India, no order minimums, ~1–2 day production approval; Tango Card / Reloadly secondary). "API credits" only **indirect & disclosed** (pay general-purpose value the dev uses to top up their *own* console). $5 min threshold; balances always USD. The wedge ("payouts that work day one") survives; the literal "API credit codes" headline does not.

## 9. Rust client deps — ⚠️ partially-supports

- ✅ Verified (2026-06-12): `keyring` 4.0.1, `ed25519-dalek` 2.2.0 (pin 2.x; 3.0 rc), `blake3` 1.8.5, `ulid` 1.2.1 (or `uuid` v7 1.23.3), `serde_json` 1.0.150, `notify` 8.2.0, `tokio` 1.52.3, `self_update` 0.44.0, `minisign-verify` 0.2.5, `tempfile` 3.27.0.
- ❌ **"Non-exportable keys" is false for `keyring`** — it stores readable, encrypted-at-rest secret blobs. True non-exportable / Secure-Enclave needs abandoned `keychain-services` or `security-framework` FFI + codesigning. Downgrade the claim; hardware-bound is a separate track.
- ❌ **`self_update` verifies zipsign (ed25519), not minisign** — verify with `minisign-verify` yourself then replace, or use zipsign natively. Don't assume the pairing.
- ⚠️ Canonical JSON for signing must use `serde_json_canonicalizer`/`serde_jcs`, a **separate** path from settings `preserve_order`. `<1 MB` stripped hot-path binaries are "ambitious but achievable" only with lean deps + `panic=abort` + `opt-level=z` + `cargo-zigbuild`/`lipo` + a CI size gate. systemd/launchd: no turnkey crate — write unit/plist + shell `systemctl`/`launchctl`.

## 10. Rust backend stack — ✅ supports

- ✅ `axum` 0.8, `sqlx` 0.8 (compile-time-checked; prefer over diesel), `redis-rs`/`fred`, official `clickhouse` crate (use `Inserter`, batch 10k–50k). ✅ **Ledger:** adopt/port **`pgr0ss/pgledger`** (all-in-Postgres PLpgSQL, ULID, append-only, sum-to-zero, per-entry balance snapshots) — near-exact match; reuse don't hand-roll.
- ✅ Scale conservative: ClickHouse ~200× headroom at 4.6k/s; Postgres ~28 rows/s with hourly aggregation; redirector p99<50 ms realistic.
- ⚠️ Hot-spots: 3-layer idempotency (Postgres unique constraints + `ON CONFLICT DO NOTHING`), ClickHouse exactly-once (durable buffer — Redis stream/Kafka — between ingest and ClickHouse), ledger hot-account contention (shard the house account).

## 11. OSC 8 click surface — ⚠️ partially-supports

- ✅ OSC 8 real, broadly supported; ✅ Claude Code **statusline** docs explicitly support OSC 8 with examples. ❌ **The spinner (`spinnerVerbs`) is plain-text and NOT clickable** — don't imply "click the spinner." Ad copy in spinner (impression-only); clickable shortlink in statusline.
- ❌ Operationally fragile inside CC (OSC-8-stripping regressions; clicks fail in tmux/Konsole sometimes). → **clicks are a best-effort bonus, not core revenue**; accounting is impression-based; clicks server-attributed via `/c/{code}`. Emit `ESC]8;;ST`, short URLs, server-side allow-listing vs spoofing.

## 12. Kickbacks.ai (incumbent) — ⚠️ partially-supports

- ✅ Real, launched June 11, 2026 by **Andrew McCalip**. Confirmed: 1,000×5s blocks; clicks 50×; open auction from $1; highest-bid-serves; 50/50 split; VS-Code-first ("Apologies, terminal jockeys"); spinnerVerbs replacement; Stripe Connect "coming" ($10 min, monthly) **not live**; no real third-party advertisers (bootstraps own inventory).
- ⚠️/❌ **Corrections:** "~614K launch-day views" is a single viral X-post snapshot (556K–614K; ~3.6M cumulative per secondary coverage) — say "a viral X launch post." **"Overwhelmingly positive" is overstated** (~74% positive / ~26% negative across ~336 comments; tiny HN submission). "$0.011/impression" is one tester's observed rate ($4.43 / 407 imp), **not** a posted price; $1/block floor = $0.001/impression — model against the floor and near-zero demand.
- spnr's clean wedges: terminal-native + payout credibility (if it ships) + attested events vs Kickbacks' self-reported local-HTTP counting.

## 13. Legal / regulatory — ⚠️ partially-supports (informational, not legal advice)

- ✅ Closed-loop gift cards / store credit **materially lower** money-transmitter risk (FinCEN 31 CFR 1010.100(ff)(5)(ii)(E); under $2,000/day also outside the prepaid-program BSA regime (ff)(4)(iii)(A)). → launch credits/gift-card-only, keep per-user daily redemption <$2,000, disburse via a licensed vendor (Tremendous/Tango/Reloadly) so they carry gift-card/escheat/AML.
- ✅ USDC = convertible virtual currency; exchanger = MSB/MT unless exempt → **gate the USDC rail behind a real MSB/MTL + crypto legal opinion.**
- ⚠️ **India tax understated:** earning USDC is likely ordinary income on receipt (slab rates, zero cost basis), *then* 30% (s.115BBH) + 1% TDS (s.194S) on transfer — the spec's "30% + 1% TDS" misses the income-on-receipt event. Draft India copy with a CA.
- ❌ **FTC compliance is not optional:** 16 CFR Part 255 clear-and-conspicuous "sponsored/ad" disclosure; Business Opportunity Rule (16 CFR 437) + pending 2025 Earnings-Claims rule → "earn $X" needs written substantiation + "results not typical." Four counsel tracks gated per phase.

## 14. Namespaces & domains — ⚠️ partially-supports (act now)

- ✅ crates.io `spnr` **free** → reserve 0.0.1 now. ✅ npm `spnr` **taken** (dormant frontend lib) → scope `@spnr/*` (claimable; beware confusable `@spnrapp`).
- ❌ **GitHub `spnr` is NOT free** — it's a dormant **user** account "SPNR" (id 13784566, since 2015, last active 2016). The earlier "404→free" checked `/orgs/spnr`. → pick an alt org handle (`spnr-sh` / `spnrhq` / `getspnr`) or acquire the dormant name.
- ❌ **spnr.sh and spnr.co are UNREGISTERED/AVAILABLE** (whois/RDAP) — the spec's "owned" is **refuted**. **Register both now.** ⚠️ spnr.dev **is** registered (Porkbun, 2023-12-06, serving 502) — **ownership unverified** (confirm it's the founder's). ✅ spnr.com is a long-held third-party parked squat-risk (expires 2026-09-17) — keep the anti-phishing posture.

---

## Spikes to run before / during v0.1 (de-risk the survivors)

| ID | Spike | Resolves | Gates |
|----|-------|----------|-------|
| S1 | Set `spinnerVerbs {mode,verbs}` on live Claude Code; test char limit, project-override, reload timing | §1 format/limits/reload uncertainty | spinner adapter |
| S2 | Benchmark end-to-end hook latency (`spnr-hook` datagram-and-exit) under load | §2 latency; default-on vs opt-in | invariant 1 |
| S3 | Measure `statusLine` invocation cadence under heavy output; set the gate-window constant | §3 coarse-gate window | impression engine |
| S4 | Confirm OSC 8 statusline click survives current CC version + tmux | §11 click surface | clicks (bonus) |

## Primary sources (selected)

- Claude Code docs: code.claude.com/docs/en/settings.md (spinnerVerbs, statusLine, hooks); anthropics/claude-code issues #21599 (spinnerVerbs undocumented), #43826 (statusLine mid-session stop).
- x402: x402.org; Linux Foundation x402 Foundation (Apr 2, 2026); crates.io `x402-axum` / `x402-reqwest` v1.5.6.
- USDC/Base: Base docs; Chainlink USDC/USD feed; USDC contract `0x8335…2913`.
- Payouts: OpenAI Service Credit Terms (no transfer/sale/gift/trade); Tremendous / Tango Card / Reloadly API docs.
- Legal: FinCEN 31 CFR 1010.100(ff); 2013/2019 CVC guidance; FTC 16 CFR Part 255 & 437; India IT Act s.115BBH / s.194S.
- Market: kickbacks.ai (+ ToS, GitHub, VS Code Marketplace), HN item 48493940, McCalip X launch post.
- Ledger reference: github.com/pgr0ss/pgledger. Rust crates: crates.io API (versions as of 2026-06-12).

> Full per-stream output (with every key-fact citation) is archived at the workflow task output for run `wf_37cde9a3-0dd`.
