# spnr — Impression Engine

> How spnr decides what counts as a billable impression in a terminal that has no DOM and no viewability API.
> Status: Draft v0.3 · June 12, 2026

This document specifies the per-session impression state machine, the signals that drive it, the accrual rule and caps, and why the design resists the obvious farming attacks. It is the operational heart of **invariant 3 (undercount, never overcount)**.

Cross-references:
- Protocol envelope, hash chain, idempotency → [03-protocol-SAP1.md](03-protocol-SAP1.md)
- Server-side fraud scoring (the real moat) → [05-fraud-attestation.md](05-fraud-attestation.md)
- The statusline coarse-gate decision → [adr/0002-statusline-as-coarse-liveness-gate.md](adr/0002-statusline-as-coarse-liveness-gate.md)
- Content firewall enforcing invariant 2 → [07-security-privacy.md](07-security-privacy.md)
- Validated research corrections with citations → [13-research-findings.md](13-research-findings.md)
- Open questions (cadence constant, version matrix) → [12-risks-open-questions.md](12-risks-open-questions.md)

---

## 1. Definitions

| Term | Definition |
|---|---|
| **Wait interval** | A continuous span in an interactive session where the host is awaiting model output and the spinner is animating. Opened by `UserPromptSubmit`, closed by `Stop` **or** by timeout (see §6). Tool-execution time is excluded (§4). |
| **Countable second** | A 1-second tick inside a `WAITING` wait interval that satisfies the accrual predicate (§5): a render heartbeat landed recently, the TTY is attested, and the session is not paused. |
| **Impression** | Exactly **5 contiguous countable seconds** within one wait interval. The trailing partial (`countable_seconds mod 5`) is **dropped, never rounded up** (invariant 3). |
| **Render heartbeat** | A signal, emitted when `spnr-status` is invoked by the host `statusLine`, that an interactive TUI painted recently. It is a coarse liveness gate, **not** a per-frame attestation (§3, ADR-0002). |
| **TTY attestation** | A per-session boolean: the session's controlling process is attached to an interactive TTY. False for headless `claude -p`. |

> **Research correction:** The original spec framed each statusline invocation as "one human-visible render" and proposed frame-granular "device-signed render attestation." Research refuted this: `statusLine` fires on **message boundaries with a ~300 ms debounce**, not per paint, and carries no frame-level timestamp. The impression is therefore defined against **hook-derived wait intervals gated by coarse liveness**, not against render counts. See [13-research-findings.md](13-research-findings.md) §A and [adr/0002-statusline-as-coarse-liveness-gate.md](adr/0002-statusline-as-coarse-liveness-gate.md).

### Invariant alignment

- **5-contiguous-seconds-or-nothing** makes the unit conservative: a 9-second wait yields 1 impression, not 2, not 1.8.
- Every ambiguity below (missing `Stop`, missing heartbeat, untrusted timestamp, concurrent sessions) resolves **against spnr's revenue**.

---

## 2. Signal sources

The daemon (`spnrd`) reconstructs wait intervals from host hooks and gates them with the statusline heartbeat. Hook payloads arrive on `spnr-hook` stdin; only `{hook_event_name, session_id}` are extracted via the restricted extractor (content firewall, [07-security-privacy.md](07-security-privacy.md)). The timestamp is **stamped on daemon receipt**, not read from the payload (§6).

| Signal | Source | Meaning in the state machine |
|---|---|---|
| `SessionStart` | hook | Register session; rotate active creative; bind `(session_id → creative_id)` for the whole session. |
| `SessionEnd` | hook | Close session; flush queue; finalize any open interval (timeout-close, §6). |
| `UserPromptSubmit` | hook | **Open** a wait interval → `IDLE → WAITING`. |
| `PreToolUse` | hook | **Pause** accrual → `WAITING → TOOL_RUNNING`. |
| `PostToolUse` | hook | **Resume** accrual → `TOOL_RUNNING → WAITING`. |
| `Stop` | hook | **Close** the wait interval → `WAITING → IDLE`. **Not guaranteed once per turn** (§6). |
| render heartbeat | `spnr-status` ping (via `statusLine`) | Gate: an interactive TUI painted within the gate window. Coalesced to ≤ 1 ping/sec. |
| TTY check | hook env + controlling terminal of the session pid | Sets `session.tty_attested`. Headless ⇒ false ⇒ nothing counts. |

> **Research correction:** Only 7 of Claude Code's 26+ hook events are used, and they carry caveats — `Stop` can be dropped, payload timestamps are inconsistent across versions, and users can `disableAllHooks`. The engine treats all hook bracketing as best-effort and never assumes clean turn boundaries. See [13-research-findings.md](13-research-findings.md) §A.

### What the signals do **not** give us

- No per-frame render events (statusline is debounced; §3).
- No trustworthy wall-clock from the host (we stamp our own; §6).
- No content of any kind — the extractor links no general JSON deserializer for hook stdin ([07-security-privacy.md](07-security-privacy.md)).

---

## 3. The statusline coarse-gate (ADR-0002)

The heartbeat is the difference between "an interactive TUI is mounted on this terminal" and "a script is looping `claude -p`." But it is **coarse**, so the engine uses it as a gate, not a counter.

> **Spike result (S3 — [15-spike-results.md](15-spike-results.md)):** statusLine fires on **message boundaries** (~300 ms debounce), which alone would not tick *during* a wait. spnr therefore configures `statusLine` with **`refreshInterval: 1`** to obtain a **~1 Hz wall-clock liveness tick** throughout the wait. The tick proves an interactive TUI is mounted — **not** that a human is looking right now (it is a timer) — so presence-damping (rule 5) still applies. Headless `claude -p` never mounts the TUI → never ticks → earns nothing.

```
statusLine refreshInterval: 1   (≈1 Hz wall-clock tick)
   + message boundaries          (debounced ~300 ms)
        │
        ▼
   statusLine invokes  spnr-status
        │  prints cached line from tmpfs, pings daemon (≤1/sec coalesce)
        ▼
   spnrd records  heartbeat_at[session] = receipt_monotonic
        │
        ▼
   gate predicate:  (now - heartbeat_at[session]) <= GATE_WINDOW_MS
```

Design rules:

1. **Gate, do not count.** A heartbeat never *adds* a second; it only *permits* a `WAITING` second to be countable. With no genuine `UserPromptSubmit`→`WAITING` interval underneath, there is nothing to permit (this is what defeats heartbeat spammers, §7).
2. **`GATE_WINDOW_MS` is a published constant, measured empirically.** Because cadence is debounced and can be throttled under heavy output, the window must be wider than a naive "last 1 s." We publish the exact value rather than hardcode a guess.

   | Constant | Provisional value | Basis |
   |---|---|---|
   | `STATUSLINE_DEBOUNCE_MS` | ~300 ms | Observed host debounce (confirm per version). |
   | `GATE_WINDOW_MS` | **debounce + measured cadence margin** (start ~2 s, widen if measured cadence > 2 s) | Tech-spec §15 Q2; finalize before paid campaigns. See [12-risks-open-questions.md](12-risks-open-questions.md). |

3. **Measure, don't assume.** The real cadence under heavy model output is an open engineering question. The launch gate is calibrated from the host-replay harness ([08-testing-strategy.md](08-testing-strategy.md)) against real anonymized timing fixtures, not from theory.
4. **statusline is fragile.** It can stop updating mid-session after the first response (host issue #43826) and has had OSC-8-stripping regressions. When heartbeats stop, accrual stops — which is the correct (undercounting) failure direction. Click-surface degradation is handled separately ([06-money-settlement.md](06-money-settlement.md)); it does not affect impression counting.
5. **The tick is liveness, not attention.** `refreshInterval` is a wall-clock timer that keeps firing even if the human looks away from an open interactive session. **Presence-damping** (terminal focus where the terminal exposes it; otherwise input-activity cadence) separates *watching* from *idle-but-mounted*, decaying countable seconds toward zero without fresh evidence of a human. On any ambiguity, undercount (invariant 3).

> **Research correction:** The honest advertiser claim is **"attested + anomaly-filtered," never "viewability-grade."** The statusline gate establishes liveness, not IAB-grade viewability. The real fraud moat is server-side timing-distribution analysis ([05-fraud-attestation.md](05-fraud-attestation.md)), not this client signal. See [adr/0002-statusline-as-coarse-liveness-gate.md](adr/0002-statusline-as-coarse-liveness-gate.md).

---

## 4. Per-session state machine

Maintained in `spnrd`, one instance per live `session_id`.

```
            UserPromptSubmit                    Stop  (or timeout-close, §6)
   ┌────┐ ──────────────────────► ┌─────────┐ ──────────────────────► ┌────┐
   │IDLE│                         │ WAITING │                         │IDLE│
   └────┘ ◄───────────────────────└─────────┘                         └────┘
                                    │   ▲
                          PreToolUse│   │PostToolUse
                                    ▼   │
                              ┌─────────────┐
                              │ TOOL_RUNNING│   (time here NEVER counts)
                              └─────────────┘
```

### State table

| State | Entered by | Accrues? | Exits |
|---|---|---|---|
| `IDLE` | init, `Stop`, `SessionEnd`, timeout-close | no | `UserPromptSubmit` → `WAITING` |
| `WAITING` | `UserPromptSubmit`, `PostToolUse` | **yes** (per §5 predicate) | `Stop` → `IDLE`; `PreToolUse` → `TOOL_RUNNING`; timeout → `IDLE` |
| `TOOL_RUNNING` | `PreToolUse` | **no** | `PostToolUse` → `WAITING`; `Stop` → `IDLE`; timeout → `IDLE` |

### Why `TOOL_RUNNING` is excluded

When a tool runs, the spinner is not the foreground wait surface (tool output may stream; the human may be reading results). Counting tool time would risk overcounting, so it is conservatively dropped. A wait interval that bounces `WAITING → TOOL_RUNNING → WAITING` accrues only the `WAITING` segments; the contiguity for the 5-second rule resets at each tool boundary (a tool break is not 5 *contiguous* `WAITING` seconds across the gap).

> **Research correction:** Tool-execution exclusion assumes `PreToolUse`/`PostToolUse` bracket cleanly, but exit-code-2 blocking semantics do not apply uniformly (e.g. not to `PostToolUse`) and hooks must always exit 0. The daemon treats a missing `PostToolUse` like any other dropped close: the timeout-close path (§6) eventually drains `TOOL_RUNNING` back toward `IDLE` without accrual. See [13-research-findings.md](13-research-findings.md) §A.

---

## 5. Accrual rule and caps

### Per-1-second tick (only while `WAITING`)

```
countable_second :=  heartbeat_within_gate          // (now - heartbeat_at[session]) <= GATE_WINDOW_MS
                  && session.tty_attested            // interactive TTY, not headless
                  && !session.paused                 // user not paused / killswitch not active
```

```
on tick (1 Hz, monotonic clock):
    if state != WAITING:           continue        // IDLE / TOOL_RUNNING accrue nothing
    if not countable_second:       reset_contiguity()   // a gap breaks the 5-second run
    else:
        contiguous += 1
        if contiguous == 5:
            interval_impressions += 1
            contiguous = 0          // next impression needs a fresh 5 contiguous seconds
```

On wait-interval close, the trailing `contiguous` (< 5) is **discarded**. Equivalently:
`impressions(interval) = floor(countable_seconds_in_contiguous_runs / 5)` where any non-countable tick splits the run.

### Caps (client enforces a superset; server enforces the authoritative values)

| Cap | Value | Rationale |
|---|---|---|
| Per wait interval | **≤ 60 impressions** (= 300 s continuous wait) | Beyond 5 minutes of unbroken wait, something is wrong; also doubles as the timeout-close backstop (§6). |
| Per device per hour | **≤ 600 impressions** | Plausible-human ceiling; server-tunable. |
| Per device per day | **≤ 4,000 impressions** | Matches tech-spec; server-tunable. |
| Concurrent counting sessions | **1 per device** | A human watches one terminal at a time (invariant 3). |

### One-concurrent-counting-session rule

Parallel sessions (multiple panes/tabs) are *tracked*, but **countable seconds are globally single-threaded per device**: at any tick, at most one session's `WAITING` second is countable. If two sessions are simultaneously `WAITING` with valid heartbeats, the daemon credits exactly one (deterministic tie-break: the session whose current wait interval opened earliest). The other accrues nothing for that tick. This makes "20 panes farming in parallel" yield no more than "1 pane," which is the honest model of a single human's attention.

---

## 6. Hook bracketing caveats (timeout-close and timestamps)

Two corrections drive the most important robustness decisions in this engine.

### 6.1 `Stop` is not guaranteed once per turn → timeout-close

Interrupts (Ctrl-C), API errors, and blocking hooks can drop the `Stop` that should close a wait interval. If the engine waited for `Stop`, a dropped close would leave a session `WAITING` forever and (worse) keep accruing.

**Mitigation — every wait interval also timeout-closes:**

```
on tick:
    if state in {WAITING, TOOL_RUNNING}
       and (now - interval_open_at) > MAX_INTERVAL_SECS:     // MAX_INTERVAL_SECS = 300 (= the 60-impression cap)
        close_interval()        // emit floor(countable/5), then → IDLE
```

So the ≤ 60-impressions-per-interval cap and the timeout-close are the **same backstop**: an interval that never receives `Stop` is closed at 300 s with at most 60 impressions, and the session returns to `IDLE`. A late `Stop` arriving after a timeout-close is idempotent (the interval is already closed; it is a no-op).

> **Research correction:** The original spec's bracketing implicitly trusted clean `UserPromptSubmit`→`Stop` pairing. Research found `Stop` is droppable; the engine never assumes clean bracketing and relies on timeout-close as a first-class path, not an error case. See [13-research-findings.md](13-research-findings.md) §A.

### 6.2 Never trust hook timestamps → stamp on daemon receipt

Hook payload timestamp availability is inconsistent across host versions, and a hostile client could forge them. The daemon therefore ignores any payload time and captures its own:

```
on hook datagram received:
    recv_mono = Instant::now()          // monotonic, for interval/tick math (immune to wall-clock jumps)
    recv_wall = SystemTime::now()       // wall clock, for the event envelope `t` (server re-checks ±5 min)
```

- **All interval and tick arithmetic uses `recv_mono`.** This is robust to NTP steps and clock skew.
- The event envelope's `t` (wall clock) is advisory; the server quarantines events whose receipt time deviates > ±5 min and re-derives accrual server-side from the chained, counter-ordered event stream ([03-protocol-SAP1.md](03-protocol-SAP1.md)). Economic truth is server-side (invariant 4).

> **Research correction:** "Read the timestamp from the hook payload" is unsafe. Stamp on daemon receipt with a monotonic clock for math and a wall clock only for the advisory envelope field. See [13-research-findings.md](13-research-findings.md) §A.

### 6.3 Silent opt-out

Users can disable all hooks (`disableAllHooks`). When hooks stop arriving, no intervals open, nothing accrues — the correct (undercounting) outcome. The daemon does not attempt to detect or fight this; it simply earns nothing, consistent with invariant 1 (never degrade the host) and invariant 6 (fail quiet, fail stock).

---

## 7. Why this resists the obvious attacks

| Attack | Why it earns nothing |
|---|---|
| **Headless farming** (`claude -p` loops, CI, cron) | No interactive TTY ⇒ `tty_attested = false`; also no `statusLine` invocation ⇒ no heartbeats. Both predicate terms fail. Confirmed: headless runs do not invoke statusline. |
| **Detached / idle tmux pane overnight** | Nothing repaints ⇒ no heartbeats land within `GATE_WINDOW_MS` ⇒ `WAITING` seconds are not countable. Long idle waits accrue zero. |
| **Fake-heartbeat** (calling `spnr-status` in a loop) | Heartbeats only *gate*; they need a real hook-derived `WAITING` interval underneath. Without genuine `UserPromptSubmit`/`Stop` events there is nothing to gate. Forging both at once produces a regular timing distribution the server fraud model targets (KS-distance vs heavy-tailed human cadence — [05-fraud-attestation.md](05-fraud-attestation.md)). |
| **Replay** (resending captured events) | Per-device hash chain + persisted monotonic counter + ULID dedup make replays and gaps server-detectable; duplicates are rejected at ingest ([03-protocol-SAP1.md](03-protocol-SAP1.md)). |
| **Parallel-pane multiplexing** | One-concurrent-counting-session-per-device cap (§5): N panes ≤ 1 pane of credit. |
| **Inflated turns** (sleeping mid-wait to pad seconds) | Per-interval cap of 60 impressions + timeout-close at 300 s; and a uniformly padded interval is exactly the regular distribution the fraud model flags. |

The client gates are deliberately conservative (they remove obviously-fake inventory cheaply), but the **load-bearing fraud defense is server-side**: timing-distribution anomaly scoring on the chained event stream. See [05-fraud-attestation.md](05-fraud-attestation.md). The client is assumed hostile (invariant 4); these gates exist to undercount, not to "prove" anything client-side.

> **Research correction:** The spec's strongest anti-fraud claim leaned on the statusline render-heartbeat as a near-viewability primitive. With the heartbeat downgraded to a coarse gate, the moat shifts to server-side anomaly filtering, and the marketed strength is "attested + anomaly-filtered." See [adr/0002-statusline-as-coarse-liveness-gate.md](adr/0002-statusline-as-coarse-liveness-gate.md).

---

## 8. The `spnr-meta` reconciliation cross-check (content-firewalled)

Hook-derived intervals are the **primary** counting path. As a secondary, never-primary sanity check, the restricted crate `spnr-meta` reads per-turn **timing only** from session JSONL metadata and reconciles it against the engine's emitted impressions.

```
primary:    hooks + heartbeat gate  ──►  interval_impressions  (what gets emitted)
secondary:  spnr-meta timing read   ──►  reconciliation_estimate
            if |primary - secondary| / max(1, secondary) > RECON_TOLERANCE:
                flag session for server-side review   // never auto-credits, never increases payout
```

Hard rules:

- **Reconciliation can only *flag*, never increase accrual.** It is an undercount guard and an anomaly input, consistent with invariant 3. If primary > secondary by a wide margin, the session is flagged for review; the lower figure is never overridden upward by this path.
- **`spnr-meta` is content-firewalled.** Its parser type cannot produce strings from `content`/`message`/`text` fields; a CI AST-walk fails the build if those field names are referenced, and an egress-canary harness asserts fixture secrets never appear in any outbound byte (invariant 2 — see [07-security-privacy.md](07-security-privacy.md)).
- It reads timestamps and event types **only**, the same closed-world discipline as the hook extractor.

> **Research correction:** `spnr-meta` is explicitly *not* the counting authority — JSONL reading is a reconciliation cross-check, not the source of truth, precisely so the content firewall can be type-enforced and the primary path stays hook-driven. See [07-security-privacy.md](07-security-privacy.md) and [13-research-findings.md](13-research-findings.md) §A.

---

## 9. End-to-end worked example

A real wait with a tool break and a dropped `Stop`:

```
t=0    UserPromptSubmit         IDLE → WAITING        interval opens (recv_mono stamped)
t=0..6 heartbeats every ~1.5s   WAITING               6 countable seconds → contiguous run [0..6)
t=6    PreToolUse               WAITING → TOOL_RUNNING contiguity reset (run had 6s → 1 impression at t=5)
t=6..9 (tool runs)              TOOL_RUNNING          0 countable
t=9    PostToolUse              TOOL_RUNNING → WAITING new contiguous run starts
t=9..17 heartbeats              WAITING               8 countable seconds → 1 impression (5), 3 dropped
t=17   (Stop dropped — interrupt)                     no close event arrives
...    no further hooks
t=309  tick: now - open > 300   WAITING → IDLE         timeout-close; interval finalized
```

Result: **2 impressions** (one from the pre-tool run, one from the post-tool run). The 3 trailing seconds and the tool time are dropped; the dropped `Stop` is handled by timeout-close; counting used `recv_mono` throughout. Every ambiguity resolved downward.

---

## 10. Open questions (tracked, not blockers)

- **`GATE_WINDOW_MS` final value** — calibrate from real cadence under heavy output; publish the constant. (tech-spec §15 Q2; [12-risks-open-questions.md](12-risks-open-questions.md))
- **Per-version hook field matrix** — pin against tested Claude Code versions; the adapter declares supported ranges. `spinnerVerbs`/hooks are fragile, possibly-undocumented surfaces Anthropic can change without deprecation guarantees (see [adr/0004-platform-risk-adapter-abstraction.md](adr/0004-platform-risk-adapter-abstraction.md)).
- **Hook invocation overhead** — fire-and-forget is not free (~200 ms observed in some setups); benchmark real end-to-end `spnr-hook` latency before default-on (invariant 1). ([12-risks-open-questions.md](12-risks-open-questions.md))
- **`RECON_TOLERANCE`** — set the reconciliation flag threshold from replay-harness data before paid campaigns.

*Impression engine — Draft v0.3, June 12, 2026.*
