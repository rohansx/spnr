# spnr — Product Overview & Technical Specification

> **Name:** `spnr` (final) · **Domains:** spnr.sh (primary + installer) · spnr.dev (docs/protocol) · spnr.co (advertiser portal)
> **One-liner:** The open, terminal-native ad network for AI-agent wait states — settled per-impression over x402, paid out as credits on day one.
> **Status:** Draft v0.2 · June 12, 2026
> **Author:** Rohan Sharma

> **NOTE (preserved source):** This is the original product overview as authored, reproduced verbatim. Validated corrections from research live in `../13-research-findings.md`, `../00-product-overview.md`, and the ADRs. Where this document and the refined docs disagree, the refined docs win.

---

## 1. Executive Summary

Kickbacks.ai (launched June 11, 2026) proved a market exists: the Claude Code spinner — "the most-watched line on Earth" — can be sold as ad inventory, with revenue split 50/50 with the developer whose machine displayed it. It hit ~614K views on launch day with overwhelmingly positive sentiment.

But Kickbacks shipped with four structural gaps: **(1)** payouts don't work yet (Stripe "coming," no date), **(2)** terminal-CLI users are explicitly second-class ("Apologies, terminal jockeys"), **(3)** the backend — auction, impression counting, settlement — is closed-source, which is a trust problem for software that runs on developer machines and counts money, and **(4)** there is no credible answer to impression fraud outside the IDE.

`spnr` attacks all four:

| | Kickbacks.ai | spnr |
|---|---|---|
| **Install** | VS Code Marketplace + sign-in | `curl -fsSL get.spnr.sh \| sh` or Claude Code plugin (one command) |
| **Primary surface** | IDE extension | Terminal-native (CLI-first), IDE-compatible |
| **Payouts** | Accruing only; Stripe pending | Day-one redemption: API credits (default), USDC via x402 (opt-in) |
| **Backend** | Closed | Open protocol + open-source reference implementation; self-hostable |
| **Settlement rail** | Fiat (pending) | x402 / USDC micro-settlement under the hood |
| **Fraud answer** | IDE viewability checks | Signed impression attestations + behavioral anomaly detection |
| **Geo coverage** | Stripe-supported countries | Global (credits + stablecoin work everywhere) |

The wedge is **payouts that work on day one**. The moat is **verifiable impressions in a terminal**. The story is **the open protocol** — anyone can run a network; spnr operates the flagship one.

---

## 2. Market Context

### 2.1 What Kickbacks proved

- The inventory is real: the Claude Code spinner verb (`spinnerVerbs` in `~/.claude/settings.json`) is an intentionally exposed setting; replacing it with a sponsored line is sanctioned configuration, not a hack.
- Demand-side mechanics work: blocks of 1,000 five-second impressions, clicks billed at 50× impression rate, open auction from $1, highest bid serves first.
- Users tolerate — even like — it: an ad *outside* the context window doesn't break trust the way an ad *inside* model output would. Early users report ~$0.011/impression, with realistic earnings covering an entire Claude subscription per month.
- Distribution is viral: "get paid to wait" is a self-spreading pitch.

### 2.2 What Kickbacks left open

1. **The money loop is incomplete.** Earnings accrue; nothing pays out. The single most important feature of a "get paid" product doesn't exist yet.
2. **Terminal users are unserved.** A large share of Claude Code's heaviest users live in tmux/ssh/neovim, not VS Code.
3. **Trust is asserted, not provable.** Only the client is open-mirrored. The auction and the counting are opaque.
4. **No targeting.** One global slot, blind buying. No segmentation by stack, geography, or context.
5. **Geography.** Stripe payouts exclude or complicate most of the Global South — including India, one of the largest Claude Code user bases.
6. **Fraud.** Headless `claude -p` loops can farm impressions. The IDE viewability check doesn't exist in a terminal. Nobody has solved this; whoever does owns advertiser trust.

### 2.3 Timing

The category is ~48 hours old and riding a hype wave. Realistic window to ship a credible alternative: **2–3 weeks** before the space is crowded or interest decays. Platform risk is real and shared by all players: `spinnerVerbs` exists at Anthropic's pleasure; a deprecation kills the category. Build accordingly (thin client, multi-surface adapters, low fixed cost).

---

## 3. Product Overview

### 3.1 Positioning

**For developers:** "Your spinner pays for your Claude subscription." Install with one command, redeem from day one. No surveys, no wallets (unless you want one), no waiting for Stripe.

**For advertisers:** "The only verified terminal ad slot." Buy attention from the highest-intent developer audience on Earth — people actively running AI coding agents — with cryptographically attested impressions and per-impression settlement.

**For the ecosystem:** An open protocol (auction spec + attestation spec + settlement spec). spnr is the reference network, not a walled garden. Matrix-to-their-Slack.

### 3.2 Target users

**Supply side (developers):**
- Terminal-first Claude Code / Codex CLI users (the audience Kickbacks apologized to)
- International devs without Stripe-compatible banking (India, SEA, Africa, LATAM)
- Privacy-conscious devs who won't run closed telemetry binaries but will run an auditable one

**Demand side (advertisers):**
- Dev-tool companies (the Linear/Vercel/Sentry tier) — already the proven buyer profile
- AI infra/API companies targeting agent users specifically
- Phase 2: **AI agents as buyers** — agents purchasing human-attention slots via x402 (novel, defensible, nobody else can credibly ship this)

### 3.3 Core value propositions

1. **One-command install** — `curl | sh` or `claude plugin install spnr`. No marketplace, no GUI sign-in flow. Auth via magic link or GitHub device flow printed in-terminal.
2. **Day-one redemption** — earnings redeemable immediately as Anthropic/OpenAI API credits or gift cards (default tier), or USDC over x402 (opt-in tier). Never "points" with opaque conversion: balances are denominated in USD, always.
3. **Auditable by design** — every byte that runs on the user's machine is open source; the impression ledger is verifiable; the auction logic is published.
4. **Verified impressions** — signed attestations make terminal impressions sellable to serious advertisers (see §5.6).
5. **Local-first ethos** — the daemon never reads code, prompts, or transcript content. It reads timing metadata only. Structurally incapable of exfiltrating work product (enforced by design + audit, see §5.8).

### 3.4 Payout model (three tiers)

| Tier | Mechanism | Who it's for | Notes |
|---|---|---|---|
| **Default: Credits** | Redeem USD balance → Claude/OpenAI API credits, sub offset, gift cards | Everyone | Instant, no KYC at small scale, arguably avoids money-transmitter classification, works in every country. The headline pitch. |
| **Opt-in: Stablecoin** | USDC over x402 to a user-supplied wallet | International/power users | The settlement rail already runs on-chain (§5.7); this tier just exposes it. Tax implications are the user's (clearly documented; India VDA rules linked). |
| **Never** | Vague points, crypto-as-marketing, watch-to-earn mechanics | — | Trust-destroying patterns. Explicitly out of scope. |

### 3.5 Business model

- **Take rate:** 50% to the developer (match the incumbent — going higher is a race to the bottom; going lower loses supply). Of the remaining 50%: protocol/operations.
- **Pricing (launch):** Mirror proven mechanics — blocks of 1,000 × 5-second impressions, clicks at 50× impression rate, open ascending auction, $1 minimum bid. Iterate after data.
- **Phase 2 revenue:** targeting premiums (stack/geo/context segments priced above the blind slot), agent-buyer API fees, managed self-host support for enterprises running private networks.

### 3.6 Go-to-market

1. **Week 1:** Ship MVP (terminal daemon + credits redemption + self-serve advertiser page). Launch on HN/X positioned explicitly as "the open, terminal-native one with working payouts." Seed ad inventory with own projects (CloakPipe, ctxgraph) + 3–5 friendly dev-tool founders at founder pricing.
2. **Week 2–3:** Claude Code plugin distribution; IndiaFOSS / Mumbai dev community push ("pays out in India" is a headline differentiator locally); publish the attestation spec as an RFC to anchor the "open protocol" narrative.
3. **Month 2:** x402 agent-buyer API (composes with MoltNet identity/reputation — agents with reputation scores get buying access). This is the press-worthy novel beat.

### 3.7 Explicit non-goals (v1)

- No ads inside model output or context window — ever. Surface is spinner + statusline only.
- No browser extension, no editor takeover, no notification spam.
- No collection of code, prompts, file paths, or transcript content.
- No "engagement" mechanics (streaks, multipliers, gamification).

---

## 4. System Architecture

```
┌─────────────────────────────── developer machine ───────────────────────────────┐
│                                                                                  │
│  ┌──────────────┐   hooks (SessionStart/Stop/      ┌──────────────────────────┐  │
│  │ Claude Code  │──▶ PostToolUse) + statusLine ──▶ │  spnrd (Rust daemon)     │  │
│  │ / Codex CLI  │   command invocations            │  ─ ad cache & rotation   │  │
│  └──────┬───────┘                                  │  ─ impression engine     │  │
│         │ reads spinnerVerbs                       │  ─ attestation signer    │  │
│         ▼                                          │  ─ settings merger       │  │
│  ~/.claude/settings.json  ◀── atomic merge ────────│  ─ local unix socket API │  │
│                                                    └────────────┬─────────────┘  │
│  OS keychain ◀── device key + auth token ──────────────────────┘                 │
└───────────────────────────────────────────────────────│─────────────────────────┘
                                            HTTPS (batched, signed)
                                                        ▼
┌──────────────────────────────── spnr backend ────────────────────────────────────┐
│  ad-server (creative delivery, CDN-cached)    auction engine (open-source)       │
│  ingest (attestation verification, dedup)     anomaly detection (fraud scoring)  │
│  ledger (append-only, per-account)            settlement (x402/USDC + credits)   │
│  advertiser portal (bids, creatives, stats)   redemption service (credits/gifts) │
└───────────────────────────────────────────────────────────────────────────────────┘
```

Design principles: single static binary, no runtime deps, offline-tolerant (cached creatives, queued events), structurally minimal telemetry, server-controlled killswitch, every client byte open source.

---

## 5. Technical Specification

### 5.1 Client daemon — `spnrd`

- **Language/runtime:** Rust, single static binary (musl), <10 MB, <15 MB RSS idle. Targets: linux x86_64/aarch64, macOS arm64/x86_64.
- **Process model:** user-level daemon (systemd user unit on Linux, launchd agent on macOS). Exposes a local Unix-domain-socket API (`~/.spnr/spnrd.sock`) consumed by the CLI and the statusline helper.
- **Subcommands:**
  - `spnr login` — GitHub device flow or email magic link, fully in-terminal
  - `spnr status` — balance, today's impressions, current creative
  - `spnr redeem` — interactive redemption (credits / gift card / USDC)
  - `spnr pause | resume` — instantly restore stock spinner verbs
  - `spnr audit` — dump every event sent in the last N days, human-readable
  - `spnr uninstall` — full removal incl. settings restoration
- **Secrets:** auth token + device signing key sealed in OS keychain (Secret Service / Keychain). Never written to disk in plaintext.

### 5.2 Installer

**Path A — curl (primary):**
```
curl -fsSL https://get.spnr.sh | sh
```
- Detects OS/arch, verifies binary against published SHA-256 + minisign signature, installs to `~/.local/bin`, registers the user service, runs `spnr login`, performs settings injection (§5.4), prints first-run summary.
- The install script is short, readable, and version-pinned; the README shows the manual equivalent for `curl | sh` skeptics.

**Path B — Claude Code plugin (lowest friction):**
- Distributed via Claude Code's plugin system: one in-product command installs a plugin that bundles the hook registrations and statusline command, and bootstraps/updates the daemon binary on first hook fire.
- This is the preferred long-term path: install, auth, and updates without leaving Claude Code.

**Path C — IDE extension (parity, later):** thin VS Code/JetBrains wrapper around the same daemon, reusing its socket API. One brain, many surfaces.

### 5.3 Ad delivery & rotation

- Daemon polls `GET /v1/creative?surface=spinner&slot=current` every 60s (jittered) with ETag caching; CDN-fronted.
- Creative payload: `{ id, campaign_id, text (≤48 chars), url, short_code, ttl, sig }`. Server signature verified against pinned key before display — a compromised CDN cannot inject arbitrary text.
- **Content rules enforced server-side and client-side:** plain UTF-8 text + one trailing `↗`; no ANSI escapes from creatives (client strips); allow-listed character set (terminal-injection safety); advertiser URLs domain-verified.
- On TTL expiry with no network: revert to stock verbs (fail-quiet, never fail-stale).

### 5.4 Settings injection (`spinnerVerbs`)

- Atomic read-merge-write of `~/.claude/settings.json`: parse, snapshot original `spinnerVerbs` to `~/.spnr/backup.json`, write sponsored verb list, preserve all other keys byte-for-byte where possible (write via temp file + rename).
- File watcher (inotify/FSEvents): if the user or another tool rewrites settings, re-merge politely; if the user manually removes spnr's verbs twice, treat as opt-out signal and pause with a notice.
- `spnr pause`, `spnr uninstall`, the server killswitch, and daemon crash (via a stale-lock check) all restore the snapshot. **The user's config is never left in a sponsored state when spnr isn't actively running.**

### 5.5 Impression engine (the terminal problem)

The terminal has no DOM and no viewability API. spnr derives impressions from agent lifecycle signals:

- **Sources:** Claude Code hooks (`SessionStart`, `Stop`, `PostToolUse`, `Notification`) give turn boundaries; session JSONL metadata under `~/.claude/projects/` gives per-turn timing. The daemon reads **timestamps and event types only** — a parser structurally incapable of touching `content` fields (separate restricted module, enforced in CI by a deny-list test over the parser's AST).
- **Counting:** continuous thinking time per turn ÷ 5s = candidate impressions, capped per turn and per hour.
- **TTY check:** an impression is only valid if the session is attached to an interactive TTY (hooks report environment; daemon cross-checks the session's controlling terminal). Headless `claude -p` runs earn nothing — this single rule kills the cheapest fraud vector.
- **Presence damping:** impressions decay toward zero without periodic evidence of a human (terminal focus signals where available; otherwise input-activity heartbeats from the statusline invocation cadence). Conservative by design: undercounting is acceptable, overcounting is fatal to advertiser trust.

### 5.6 Attestation & anti-fraud (the moat)

- **Device identity:** per-install Ed25519 keypair in the keychain; public key registered at login (pseudonymous, linked to account for crediting).
- **Signed events:** each impression/click event = `{ event_id (ULID), type, creative_id, session_fingerprint (salted hash), monotonic_counter, timestamp }` signed by the device key. Monotonic counter + ULID make events idempotent and replay-evident.
- **Server-side scoring:** every account gets a continuous fraud score from: impression rate vs. plausible human coding cadence, turn-length distributions (real agent turns are heavy-tailed; farms are uniform), TTY/headless ratio, multi-account device correlation, click-through anomalies. Payouts release on a 7-day rolling hold; high scores → shadow-discounted impressions (counted, unpaid) rather than instant bans, to avoid training fraudsters via feedback.
- **Transparent ledger:** per-account append-only event ledger downloadable by the user (`spnr audit`); aggregate network stats public. Advertisers get attestation coverage rates per campaign — the sellable proof terminal inventory has never had.
- **Honesty note:** terminal impressions will never be IAB-viewability-grade. The claim is *attested + anomaly-filtered*, priced accordingly, with the methodology published. Overstating this would be the fastest way to die.

### 5.7 Settlement — x402 rail

- All inter-party settlement denominated in USD, executed as USDC micro-settlements over **x402** (HTTP 402 payment flows) on a low-fee L2 (Base): advertiser escrow → per-verified-impression release → developer balance accrual; on-chain batch settlement hourly, off-chain ledger real-time.
- Developers on the credits tier never see the chain — the rail is invisible plumbing. Stablecoin-tier users receive USDC directly from the same flow with no extra infrastructure.
- **Phase 2 — agents as advertisers:** a public x402-native bid API (`POST /v1/bids` with 402 challenge/payment) lets autonomous agents purchase slots programmatically. Gate buying access on agent identity/reputation (MoltNet integration) to keep slop out of the auction. This is the genuinely novel surface no fiat-rail competitor can copy quickly.

### 5.8 Privacy & security posture

- **Never collected:** code, prompts, completions, file paths, repo names, transcript content, environment variables.
- **Collected (exhaustive):** ad event telemetry (type, creative id, surface, dedup id, timestamp), coarse install metadata (OS/arch/client version), account email. Schema published; `spnr audit` shows the raw outbound queue.
- Client fully open source (not a mirror — the actual built artifact, reproducible builds with published hashes). Backend auction + attestation verifier open-sourced as the protocol reference; only ops glue stays private.
- Server killswitch (signed) can blank creatives network-wide instantly; clients revert to stock verbs.
- Threat model doc covers: malicious creative injection (signing + charset allow-list), settings.json clobbering (atomic merge + snapshot), token theft (keychain + short-lived tokens), supply-chain (signed releases, pinned install script).
- **Domain & anti-phishing posture:** canonical domains are exactly three — **spnr.sh** (identity + `get.spnr.sh` installer), **spnr.dev** (docs + protocol RFC, registry-enforced HTTPS), **spnr.co** (advertiser portal + redemption dashboard). spnr.com is not ours; because the product involves claiming money, a squatted lookalike running a cloned redemption page is the obvious attack. Mitigations: login/redemption lives on one canonical host only; `spnr redeem` and `spnr login` open the exact URL from the CLI so users never type it; the README and every auth email state "we operate only on spnr.sh / spnr.dev / spnr.co"; monitor spnr.com and consider a defensive purchase if cheaply parked.
- **Package namespaces (verified June 12, 2026):** crates.io `spnr` is unregistered — reserve with a 0.0.1 placeholder before any public announcement (crates.io has no squat protection). npm `spnr` is taken by an unrelated frontend library — all npm packages publish under the scoped `@spnr/*` org instead (secure the org). GitHub org and X handle to be secured manually.

### 5.9 Backend services

- **Stack:** Rust (axum) services; Postgres (ledger, accounts, campaigns); Redis (auction state, creative cache); ClickHouse (event analytics/fraud features); object storage for audit exports. All boring on purpose.
- **Auction:** single-slot open ascending auction at launch (proven mechanics: $1 min, 1,000×5s blocks, clicks at 50×). Targeting segments (geo, client type) become separately auctioned slots in Phase 2.
- **Advertiser portal:** self-serve — campaign creation, creative submission (auto-linted against content rules), live bid board, attestation-coverage dashboards, USDC or card funding.

### 5.10 Failure modes

| Failure | Behavior |
|---|---|
| Backend down | Cached creative until TTL, then stock verbs; events queue locally (bounded), flush on reconnect |
| Daemon crash | Watchdog restores settings snapshot; Claude Code unaffected (hooks fail silent) |
| `spinnerVerbs` deprecated by Anthropic | Killswitch + adapter fallback to statusline-only surface; this risk is why the adapter layer exists |
| Keychain unavailable (headless box) | Daemon runs unauthenticated/paused; explicit `--insecure-token-file` opt-in only |
| Hostile creative slips through | Signed killswitch revokes creative id network-wide ≤60s |

---

## 6. Roadmap

**v0.1 — MVP (week 1):** Rust daemon, curl installer, Claude Code CLI adapter (hooks + JSONL timing), spinner injection, statusline click surface (OSC 8), GitHub device-flow auth, hosted auction with seeded inventory, credits redemption live on day one.

**v0.2 (weeks 2–3):** Claude Code plugin distribution; Codex CLI adapter; `spnr audit`; attestation spec published as RFC; fraud scoring v1; advertiser self-serve portal.

**v0.3 (month 2):** x402 USDC payout tier; targeting segments (geo, client); reproducible builds; VS Code thin wrapper.

**v1.0 (month 3):** Agent-buyer x402 API + MoltNet reputation gating; self-host kit for private networks; protocol governance doc.

**Phase 3 (month 4+, conditional): browser wait-state surface.** A browser extension monetizing wait/streaming states on consumer AI chat (claude.ai, chatgpt.com, gemini.google.com). Strict design constraints, non-negotiable:

- **Never inject into the host page's DOM or mimic its UI.** Ads render exclusively in extension-owned surfaces (side panel, toolbar popup, or a clearly spnr-branded bar), shown only while a response is pending. Injecting third-party ads visually *inside* claude.ai/chatgpt would (a) violate or antagonize host platforms' positioning — Anthropic explicitly markets its products as ad-free spaces — and (b) pattern-match to adware in Chrome Web Store review and in users' eyes. The CLI's `spinnerVerbs` surface is sanctioned configuration; DOM injection into someone else's web app is not. This line is what keeps the whole network alive.
- **Upside that justifies it:** a real DOM means real viewability (IntersectionObserver, focus/visibility events) — browser impressions are *higher*-grade than terminal attestations, and the consumer audience is 100× the CLI's. Same account, same ledger, same credits redemption.
- **Go/no-go gate:** only ship if (1) the CLI network has paying advertisers and a clean fraud record, and (2) legal review of host-platform ToS comes back tolerable. If either fails, the extension stays shelved; the CLI business stands alone.

---

## 7. Risks & open questions

1. **Platform risk (existential):** the whole category rides on `spinnerVerbs` and hooks remaining available. Mitigation: adapter abstraction, statusline fallback, low burn, ship fast. Watch Anthropic's stance — their consumer products are explicitly ad-free; tolerance for third-party spinner ads is untested policy territory.
2. **Fraud at scale:** the §5.5–5.6 design is conservative but unproven; budget for an adversarial red-team phase before opening high-value campaigns.
3. **Demand-side cold start:** the incumbent has zero real advertisers too — this is a race both sides start from zero, but supply-side virality without demand burns trust ("I earned $40 of nothing"). Seed inventory honestly labeled as house ads.
4. **Regulatory:** credits redemption keeps v1 light, but a legal read on money-transmission (US) and VDA/TDS guidance for the USDC tier (India) is needed before Phase 2. Document, don't improvise.
5. **Hype decay:** if the category is a two-week meme, the salvage value is the attestation + x402-agent-payments stack — both reusable across the existing portfolio (MoltNet, CloakPipe). Build the moat pieces as libraries, not app code.

---

*spec ends — v0.2, June 12, 2026 — name and domains locked: spnr · spnr.sh / spnr.dev / spnr.co*
