# spnr — Consolidated Technical Specification

> The engineering spec of record. Integrates and links the deep-dive docs; reflects validated research corrections over the source specs.
> **Status:** Draft v0.3 · June 12, 2026

This document consolidates the client/backend engineering design and links out to the
deep-dives that own each subsystem in detail:

- [01-architecture.md](01-architecture.md) — system architecture & data flow
- [03-protocol-SAP1.md](03-protocol-SAP1.md) — SAP/1 event & attestation protocol
- [04-impression-engine.md](04-impression-engine.md) — impression measurement, state machine, caps
- [05-fraud-attestation.md](05-fraud-attestation.md) — device identity, fraud scoring bands
- [06-money-settlement.md](06-money-settlement.md) — ledger, x402/USDC, redemption (corrected wedge)
- [07-security-privacy.md](07-security-privacy.md) — threat model, content firewall
- [08-testing-strategy.md](08-testing-strategy.md) — editor-safety suite, replay harness, fraud sims
- [09-repo-build-layout.md](09-repo-build-layout.md) — cargo workspace, verified deps
- [12-risks-open-questions.md](12-risks-open-questions.md) — risk register & open questions
- [13-research-findings.md](13-research-findings.md) — validated research with citations

Where a source spec made an optimistic claim that research refuted, the corrected reality
is stated here with a `> **Research correction:**` callout pointing to the relevant ADR or
[13-research-findings.md](13-research-findings.md). No refuted claim is repeated.

---

## 1. The six invariants

Every decision below derives from six invariants. When in doubt, resolve in this order.

| # | Invariant | Mechanical consequence |
|---|---|---|
| 1 | **Never degrade the editor/CLI.** spnr failing is invisible to the host. | Hot-path binaries have hard latency budgets; daemon crash restores stock config; hooks exit 0 always. |
| 2 | **Never read work product.** Code/prompts/completions/paths/repo-names/transcript content are structurally unreadable. | CI-enforced content firewall; restricted extractors; egress canary harness ([07](07-security-privacy.md)). |
| 3 | **Undercount, never overcount.** Every measurement ambiguity resolves against spnr's revenue. | Partial seconds dropped; caps; single-threaded counting per device ([04](04-impression-engine.md)). |
| 4 | **Machine honest until proven otherwise; network assumes every client hostile.** | Economic truth is server-side: signed, chained, idempotent events + server-attributed clicks ([03](03-protocol-SAP1.md), [05](05-fraud-attestation.md)). |
| 5 | **Everything on a user's machine is open source and reproducible.** | Published hashes; short install script; reproducible builds ([09](09-repo-build-layout.md)). |
| 6 | **Fail quiet, fail stock.** No network → cached creative until TTL → stock verbs. | Never a stale ad, never an error in the terminal. |

The only SLO that is also an invariant is **client-side editor impact = ZERO** (§9).

---

## 2. Client binaries

Four binaries from one Rust workspace ([09-repo-build-layout.md](09-repo-build-layout.md)).
The two hot-path binaries do **no** network I/O, no JSON deserialization beyond a restricted
stdin skim, and no allocation-heavy work; they write a fixed-size datagram to the daemon
socket and exit. If the daemon is down they exit 0 silently (invariants 1, 6).

| Binary | Role | Latency budget | Network | Heavy deps |
|---|---|---|---|---|
| `spnrd` | Long-running user daemon: ad cache, rotation, settings merge, impression state machine, event signing/queueing, self-update | n/a (background) | yes (batched) | keyring, notify, tokio, self_update |
| `spnr-hook` | Invoked by Claude Code hooks; forwards `{event, session, daemon-ts}` to daemon over Unix socket, fire-and-forget | **exit ≤ 50 ms hard** | none | std `UnixDatagram` + blake3 only |
| `spnr-status` | Invoked by `statusLine`; prints pre-rendered line from tmpfs, pings daemon | **exit ≤ 10 ms hard** | none | std + minimal |
| `spnr` | User CLI (login/status/redeem/pause/audit/uninstall); thin client of the daemon socket | interactive | via daemon | — |

> **Research correction:** the `<1 MB stripped` target for `spnr-hook`/`spnr-status` is
> "ambitious but achievable" only by keeping those crates dependency-lean and isolating the
> heavy deps (keyring/notify/tokio/self_update) in `spnrd`. Use `panic=abort`, `opt-level=z`,
> `cargo-zigbuild` (musl) + `lipo` (macOS universal2), and a CI size-check gate.
> See [09-repo-build-layout.md](09-repo-build-layout.md) and [13-research-findings.md](13-research-findings.md) §F.

> **Research correction (hook latency):** fire-and-forget is **not** free — observed hook
> invocation overhead can be ~200 ms in some setups. The datagram-and-exit design is correct,
> but the real end-to-end hook latency **must be benchmarked before default-on**; if it adds
> perceptible latency, make the hook opt-in or use HTTP hooks. Users can also disable all hooks
> (`disableAllHooks`) — plan for silent opt-out. See [13-research-findings.md](13-research-findings.md) §A.

---

## 3. Surfaces & host integration

Two host surfaces, deliberately decoupled: the **spinner** carries impression-only ad copy
(plain text); the **statusline** carries the clickable OSC 8 shortlink and gates liveness.

### 3.1 Spinner surface — `spinnerVerbs`

`spinnerVerbs` is a real Claude Code setting. Its format is an **object**, not a bare array:

```json
{ "spinnerVerbs": { "mode": "replace", "verbs": ["Brewing — sponsored by Acme ↗"] } }
```

- `mode` ∈ `"replace" | "append"`. spnr uses `replace` for sponsored verbs.
- Scope precedence (highest → lowest): **Managed > Local > Project > User.**

> **Research correction:** the source spec treated `spinnerVerbs` as a bare array. The real
> format is `{ mode, verbs }`, and **project-level `.claude/settings.json` CAN override user
> settings** (Project > User). v1 must **detect a project-level override and serve no spinner
> impressions there** — don't fight the user's config. See [13-research-findings.md](13-research-findings.md) §A.

> **Research correction (continuity risk):** one research stream found `spinnerVerbs`
> documented (code.claude.com/docs/en/settings.md, `{mode,verbs}` shape); another found it
> described as *undocumented / informally shipped* (anthropics/claude-code #21599), removable
> in a single release with no deprecation guarantee. Treat it as a **fragile, possibly-
> undocumented surface Anthropic can remove at will** — the core continuity risk. Verify exact
> doc status by direct test before relying on it. Mitigated by the `HostAdapter` trait (§3.4)
> and statusline-only fallback. See [12-risks-open-questions.md](12-risks-open-questions.md).

**Read-at-startup / session attribution.** The host reads verbs at process start, so
mid-session rotation cannot be relied on. Therefore `spnrd`:

1. Rotates the active creative **on SessionStart**.
2. Records `(session_id → creative_id)`.
3. Attributes **all** of that session's impressions to that one creative.

> **Research correction (hot-reload):** evidence is mixed — `spinnerVerbs` MAY hot-reload
> mid-session in the CLI, but this is contested for IDE hosts. Design for the conservative
> case: read-at-startup, rotate on SessionStart, one creative per session. **Treat hot-reload
> as a non-load-bearing bonus**, never a dependency. See [13-research-findings.md](13-research-findings.md) §A.

**Content rules (enforced client and server side):**

- ≤ 48 chars, single line, allow-list regex `^[\p{L}\p{N} —.,:'&+/↗-]{1,48}$`, exactly one
  trailing ` ↗`. **The ≤48-char rule is a self-imposed safety constraint** — there is no
  documented hard host limit; keep it anyway.
- **No ANSI/escape bytes ever** — client strips then rejects on mismatch (terminal-injection
  safety). `spinnerVerbs` is plain text; there is **no evidence it accepts OSC 8 / ANSI** —
  so the spinner is **not clickable** (see §3.2 and §E correction below).
- Brand name must appear (server lint).

### 3.2 Statusline surface — OSC 8 click + coarse liveness gate

spnr registers `statusLine.command = "spnr-status"`. The host invokes it on UI render;
`spnr-status` prints one cached line from `~/.spnr/statusline.cache` (tmpfs-backed) containing:

- earnings ticker, e.g. `spnr ▲ $4.43 today`
- the active creative's clickable link as an **OSC 8 hyperlink** to
  `https://spnr.sh/c/{short_code}?d={device_pub_short}` — terminals without OSC 8 see plain
  text (acceptable degradation). Emit the close sequence `ESC]8;;ST`; keep URLs short
  (< 2083 bytes, bytes 32–126); strict server-side URL allow-listing.

> **Research correction (OSC 8 lives on the statusline, not the spinner):** OSC 8 hyperlinks
> are broadly supported (iTerm2, kitty, WezTerm, VTE/GNOME, Windows Terminal, Alacritty,
> Ghostty, foot; tmux via opt-in passthrough), and Claude Code's **statusline** docs document
> OSC 8 with examples. The spinner is plain-text only. Do **not** imply "click the spinner."
> Ad copy lives in the spinner (impression-only); the clickable shortlink lives in the
> statusline. OSC 8 is operationally fragile in Claude Code (stripping regressions in the
> v2.1.3 / v2.1.42 era; clicks fail in tmux/Konsole in some cases) → **clicks are a best-effort
> BONUS signal, not core revenue.** Revenue accounting is impression-based; clicks are
> server-attributed via `/c/{code}`. See [13-research-findings.md](13-research-findings.md) §E, [06-money-settlement.md](06-money-settlement.md).

**Liveness gate (NOT a per-frame heartbeat) — ADR-0002.** The source spec assumed each
statusline invocation equals one human-visible render ("render heartbeat"). Research weakened
this materially.

> **Research correction (ADR-0002):** statusLine is **NOT invoked per-frame/per-paint**. It
> fires on **message boundaries with a ~300 ms debounce**, not continuously during a wait.
> There is **no frame-level timestamp** in the statusLine JSON, so frame-granular "render
> attestation" is impossible — stdin gives only session metadata + cost/duration. Known bugs:
> statusLine can stop updating mid-session after the first response (#43826) and has had
> OSC-8-stripping regressions. **Reframe statusLine as a COARSE LIVENESS GATE, not a heartbeat:**
> it gates seconds inside hook-derived WAITING intervals (a human-visible TUI painted
> "recently", within a debounce-widened window). Lean HARDER on server-side fraud scoring
> (timing-distribution analysis) as the real moat. The honest advertiser claim is
> **"attested + anomaly-filtered," never "viewability-grade."** Empirically measure the real
> cadence and widen the gate window with a published constant. See [adr/0002-statusline-as-coarse-liveness-gate.md](adr/0002-statusline-as-coarse-liveness-gate.md) and [05-fraud-attestation.md](05-fraud-attestation.md).

**What survives intact:** headless `claude -p` / non-interactive runs do **not** invoke
statusLine → headless earns nothing. This anti-fraud rule is confirmed real (§3.3 of [04](04-impression-engine.md)).

**Custom statusLine coexistence:** if the user already has a `statusLine.command`, spnr does
**not** clobber it. It offers (a) a wrapper mode appending spnr's segment to the user's
command output, or (b) spinner-only mode (reduced earnings, no click surface). Explicit choice
at install.

### 3.3 Settings mutation state machine

All mutation of `~/.claude/settings.json` follows one state machine (touches **global only**;
serves nothing where a project-level override is detected, §3.1):

```
IDLE ──install──► SNAPSHOT
        (copy user's spinnerVerbs + statusLine → ~/.spnr/backup.json, fsync)

SNAPSHOT ──► INJECTED
        (atomic write: read full file → serde_json::Value round-trip preserving
         unknown keys → write tmp in same dir → fsync → rename(2))

INJECTED ──external edit detected──► RE-MERGE
        (debounced 2 s; re-read; re-apply iff our keys absent; never touch others)

INJECTED ──user removed our keys twice in 24 h──► PAUSED
        (respect the opt-out signal; surface via `spnr status`)

INJECTED ──pause | uninstall | killswitch | daemon-stale──► RESTORED
        (write snapshot back, atomic)
```

| Property | Guarantee |
|---|---|
| Atomicity | Every write is tmp-file + `fsync` + `rename(2)`. Never a partial write. |
| Key preservation | Three-way merge on **spnr-owned keys only**; other keys' new values never overwritten. |
| Stale-lock restore | `spnrd` holds `~/.spnr/lock` with heartbeat mtime. On socket failure + lock mtime > 60 s, **any** spnr binary (`spnr-hook`/`spnr-status`) performs RESTORE itself. Restore is idempotent. |
| Invariant | The config is **never left sponsored without a live daemon.** |
| Serializers | settings.json round-trip uses `serde_json` with `preserve_order`. This is a **separate code path** from RFC-8785 canonical signing (`serde_json_canonicalizer`/`serde_jcs`) — two serializers, non-overlapping. See [13-research-findings.md](13-research-findings.md) §F. |

### 3.4 Adapter abstraction

```rust
trait HostAdapter {
    fn inject(&self);
    fn restore(&self);
    fn event_source(&self) -> EventSource;
}
```

Implementations: `claude_code_cli` (v0.1), `codex_cli` (v0.2), `claude_code_ide`/`vscode`
(thin wrapper, v0.3). **Platform risk lives behind this trait:** if `spinnerVerbs` is removed
or gated, the spinner adapter dies and **statusline-only mode continues**. This is the primary
mitigation for the continuity risk in §3.1. See [adr/0004-platform-risk-adapter-abstraction.md](adr/0004-platform-risk-adapter-abstraction.md).

---

## 4. Pointers to the deep-dives

The remaining subsystems are specified in full elsewhere; this spec only references their
contracts so the surfaces above remain self-consistent.

| Subsystem | Owned by | Key contract this spec depends on |
|---|---|---|
| Impression measurement | [04-impression-engine.md](04-impression-engine.md) | WAITING intervals from hooks; liveness-gated seconds; `floor(countable/5)`; caps (≤60/interval, ≤600/hr, ≤4000/day; one counting session per device) |
| Event & attestation protocol | [03-protocol-SAP1.md](03-protocol-SAP1.md) | Canonical JSON (RFC 8785), Ed25519 sig, per-device monotonic `ctr`, BLAKE3 `prev` hash-chain, ULID idempotency, batched ingest |
| Fraud & attestation | [05-fraud-attestation.md](05-fraud-attestation.md) | Device Ed25519 identity; green/amber/red bands; timing-distribution scoring as the real moat |
| Money & settlement | [06-money-settlement.md](06-money-settlement.md) | Double-entry ledger (port `pgledger`), x402/USDC batch settlement, gift-card redemption rail |

> **Research correction (payout wedge — ADR-0001):** the source spec's "redeem to Anthropic/
> OpenAI API credit codes" is **refuted** — neither provider sells prepaid API-credit gift
> cards or runs a reseller/fulfillment API, and OpenAI's Service Credit Terms explicitly
> prohibit transfer/sale/gift of credits. Per [ADR-0006](adr/0006-crypto-native-agent-economy-launch-wedge.md) the launch
> **default payout is USDC over x402**; the gift-card / local-payout rail via a battle-tested aggregator
> (**Tremendous**; evaluate Tango Card, Reloadly) is the **fiat off-ramp**. Any "API credits" story is indirect and disclosed (pay general-purpose
> value the dev uses to top up their own console). Minimum redemption ≥ $5; balances always in
> USD. See [adr/0001-payout-default-gift-cards-not-api-credits.md](adr/0001-payout-default-gift-cards-not-api-credits.md) and [06-money-settlement.md](06-money-settlement.md).

> **Research correction (x402 settlement — ADR-0003):** per-impression on-chain settlement is
> economically impossible (Base tx ~$0.002–$0.02 vs impression value ~$0.000001–$0.00001).
> Impressions **MUST be aggregated and developer payouts settled in batches** (hourly or
> ≥$1–$5 threshold). x402 is real and production-ready (Linux Foundation x402 Foundation,
> originated by Coinbase + Cloudflare + Stripe). Depend on the component crates **`x402-axum`**
> / **`x402-reqwest`** (v1.5.6), not the stale `x402-rs` umbrella. Facilitators do **not**
> custody funds — escrow/key-custody is spnr-owned. See [adr/0003-x402-batch-settlement-not-per-impression.md](adr/0003-x402-batch-settlement-not-per-impression.md) and [06](06-money-settlement.md).

---

## 5. Reliability & failure matrix

| Failure | Detection | Behavior | Recovery |
|---|---|---|---|
| Backend unreachable | poll timeout | cached creative within TTL → stock verbs; events queue locally (10 MB bound) | flush on reconnect; `gap` marker if dropped |
| `spnrd` crash | lock heartbeat stale > 60 s | next `spnr-hook`/`spnr-status` invocation restores settings | systemd/launchd restart; queue replays |
| Keychain absent (headless server) | probe at start | daemon runs **paused**; explicit `--insecure-token-file` opt-in only (documented risk) | n/a |
| Host updates settings schema | parse failure on merge | abort injection, restore snapshot, set PAUSED, surface in `spnr status` | adapter update via self-update |
| Project-level `spinnerVerbs` override present | scope check at SessionStart | serve **no** spinner impressions for that project; statusline (if any) continues | none needed — by design |
| `spinnerVerbs` removed/gated upstream | serve-time adapter flag | spinner adapter disabled fleet-wide; **statusline-only mode** via `HostAdapter` | product decision, not an outage |
| Hooks disabled by user (`disableAllHooks`) | no hook events arrive | silent opt-out; no impressions accrue; nothing broken | none — respect the choice |
| `Stop` hook dropped (interrupt / API error / blocking hook) | wait-interval not closed | wait-interval ALSO closes on timeout (cap ≤ 60 imp/interval enforces this); never assume clean bracketing | next event re-syncs state |
| Hostile creative approved by mistake | report endpoint + monitoring | killswitch revokes creative id ≤ 60 s | postmortem, lint update |
| Clock skew on device | server compares daemon-stamped `t` vs receipt | events outside ±5 min quarantined, accrue post-review | NTP advice in docs |
| Keychain stores readable blob (not non-exportable) | — (threat-model reality) | downgrade claim to "OS-keychain-protected, encrypted-at-rest"; hardware-bound mode is a separate track | document threat model in [07](07-security-privacy.md) |

> **Research correction (`Stop` not guaranteed once-per-turn):** `Stop` is NOT guaranteed to
> fire exactly once per `UserPromptSubmit` — interrupts, API errors, and blocking hooks can
> drop it. Design wait-interval close to **also** be timeout-close (the ≤60 imp/interval cap
> already does this). Never assume clean bracketing. Exit-code-2 blocking semantics do not
> apply uniformly (e.g. not to PostToolUse); hooks must always exit 0. See [13-research-findings.md](13-research-findings.md) §A.

> **Research correction (timestamps):** do **NOT** trust hook-supplied timestamps — stamp on
> **daemon receipt** (capture monotonic + wall-clock at the daemon). Payload timestamp
> availability is inconsistent across host versions. See [13-research-findings.md](13-research-findings.md) §A, [03-protocol-SAP1.md](03-protocol-SAP1.md).

> **Research correction (keychain):** "non-exportable keys" is **false** for the `keyring`
> crate (4.0.1) — it stores readable secret blobs. True non-exportable / Secure-Enclave keys
> need abandoned `keychain-services` or hand-rolled `security-framework` FFI + codesigning.
> Downgrade to "OS-keychain-protected, encrypted-at-rest"; treat hardware binding as a separate
> platform-specific hardening track. See [07-security-privacy.md](07-security-privacy.md) and [13-research-findings.md](13-research-findings.md) §F.

---

## 6. Service-level objectives

| SLO | Target | Notes |
|---|---|---|
| Redirector (`/c/{code}`) p99 | **< 50 ms** | Realistic: Redis `MultiplexedConnection`, 302-first then async click fire. See [13](13-research-findings.md) §G. |
| Serve endpoint (`/v1/serve`) p99 | **< 100 ms** | CDN-fronted, ETag'd, 60 s cache, jittered 45–75 s poll. |
| Ingest availability | **99.9 %** | Durable buffer (Redis stream / Kafka) between ingest and ClickHouse for exactly-once. |
| **Client editor impact** | **ZERO** | The only SLO that is also an invariant (#1). Enforced by the editor-safety suite ([08](08-testing-strategy.md)). |

**Scale sanity (conservative):** 100k devices × 4k imp/day ≈ 4.6k events/s peak — ClickHouse
has ~200× headroom; ledger writes aggregate per device-hour, keeping Postgres at ~tens of
writes/s. Redirector p99 < 50 ms is realistic. Complexity hot-spots to watch: 3-layer
idempotency, ClickHouse exactly-once ingestion, ledger hot-account contention (shard the
house/platform account), ledger serialization under concurrency. See [13-research-findings.md](13-research-findings.md) §G.

---

## 7. Hook integration caveats (consolidated)

The seven hook events used (`SessionStart`, `SessionEnd`, `Stop`, `PreToolUse`, `PostToolUse`,
`UserPromptSubmit`, `Notification`) are real but a subset of 26+. The caveats above
(§2, §5) are summarized here for the implementer; all derive from [13-research-findings.md](13-research-findings.md) §A:

1. **Benchmark real end-to-end hook latency before default-on.** ~200 ms overhead observed in
   some setups; gate default-on behind a measured budget, else opt-in / HTTP hooks.
2. **`Stop` is not once-per-turn.** Close wait-intervals on timeout as well; never assume clean
   bracketing.
3. **Stamp timestamps at the daemon**, not from hook payloads.
4. **Users can disable all hooks** (`disableAllHooks`) — plan for silent opt-out.
5. **Hooks must exit 0**; exit-code-2 blocking semantics are not uniform across events.

---

*Consolidated technical spec — Draft v0.3, June 12, 2026. Open items tracked in
[12-risks-open-questions.md](12-risks-open-questions.md); citations in [13-research-findings.md](13-research-findings.md).*
