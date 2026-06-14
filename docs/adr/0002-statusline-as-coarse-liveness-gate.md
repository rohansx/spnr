# ADR 0002 — statusLine is a coarse liveness GATE, not a per-frame render heartbeat

> Decision record for how spnr treats Claude Code's `statusLine` invocation as an anti-fraud signal.
> Status: **Draft v0.3 · June 12, 2026**

| | |
|---|---|
| **Status** | Accepted (supersedes the "render heartbeat" framing in `../source/tech-spec-v1.0.md` §2.2 / §3) |
| **Date** | 2026-06-12 |
| **Deciders** | spnr eng (impression engine, fraud) |
| **Relates to** | Invariants 1, 3, 4 · `../04-impression-engine.md` · `../05-fraud-attestation.md` · `../03-protocol-SAP1.md` · `../12-risks-open-questions.md` · `../13-research-findings.md` |
| **Supersedes claim in** | `../source/tech-spec-v1.0.md` §2.2 ("Each invocation therefore proves 'a human-visible terminal rendered now'") |

---

## Context

The source tech-spec built a load-bearing anti-fraud primitive called the **render heartbeat**: it assumed Claude Code invokes the `statusLine` command "*only when an interactive TUI actually paints*," so that **each invocation == one human-visible paint**, coalesced to ≤1 ping/sec. The impression engine then *gated* each countable second on a fresh heartbeat (`render_heartbeat within last 2 s`), and called this "the cheapest strong anti-fraud signal in the system."

Research refuted the strong form of that claim. What survives, and what does not:

| Claim (source spec) | Verdict | Detail |
|---|---|---|
| Headless `claude -p` / non-interactive runs never invoke `statusLine` → earn nothing | **CONFIRMED** | This anti-fraud rule is real and survives. Headless farming via the cheapest vector stays blocked. |
| `statusLine` is invoked **per-frame / per-paint** | **REFUTED** | It fires on **message boundaries with a ~300 ms debounce**, not continuously during a wait. There is no 1:1 mapping from invocation to human-visible paint. |
| Invocation carries a **frame-level timestamp** usable for device-signed render attestation | **REFUTED** | `statusLine` stdin provides session metadata + cost/duration only. No frame timestamp → no frame-granularity attestation is constructible. |
| `statusLine` output is reliable mid-session | **REFUTED (fragile)** | Known bugs: it can **stop updating mid-session after the first response** (anthropics/claude-code #43826), and has had **OSC-8-stripping regressions** (v2.1.3 / v2.1.42 era). Output must be treated as fragile. |

> **Research correction:** The "each `statusLine` invocation proves a human-visible terminal rendered *now*" framing in `../source/tech-spec-v1.0.md` §2.2 is **too strong**. `statusLine` fires on message boundaries with a ~300 ms debounce — not once per frame — carries no frame-level timestamp, and can stop mid-session (#43826) or strip OSC 8. See `../13-research-findings.md` §A.

The consequence: `statusLine` cannot carry the weight of a per-second viewability primitive. But the *one* property that matters for fraud — **"a human-visible interactive TUI exists and painted recently"** — is still true whenever it fires, precisely because headless runs never fire it (the CONFIRMED row above). We keep that property and discard the rest.

### What is actually in `statusLine` stdin

```jsonc
// shape (session metadata + cost/duration; NO frame timestamp, NO paint index)
{
  "session_id": "…",
  "model": { "id": "…", "display_name": "…" },
  "workspace": { "current_dir": "…", "project_dir": "…" },  // spnr-meta NEVER reads these (invariant 2)
  "cost": { "total_cost_usd": 0.0, "total_duration_ms": 0, "total_api_duration_ms": 0 },
  "version": "2.1.175"
}
```

`spnr-status` extracts **nothing** content-bearing from this. The only fact it forwards to `spnrd` is "I was invoked, on this session, at daemon-receipt wall+monotonic time." (Per the brief and ADR-adjacent guidance, we stamp time on **daemon receipt**, never trusting host-supplied timestamps.)

---

## Decision

Treat `statusLine` invocation as a **coarse liveness GATE**, not a per-frame heartbeat.

1. **Definition & mechanism.** spnr registers `statusLine` with **`refreshInterval: 1`** (verified available — [15-spike-results.md](../15-spike-results.md) S3), which re-runs `spnr-status` on a **~1 Hz wall-clock timer** *in addition to* message-boundary updates. A *liveness ping* is one such invocation, coalesced to ≤1 ping/sec, recorded with a **daemon-receipt** timestamp (monotonic + wall). It asserts only: *an interactive TUI is mounted and repainted recently on this session.* Because `refreshInterval` is a **timer**, a ping does **not** assert a human is looking right now — that is handled by **presence-damping** (`../04-impression-engine.md` rule 5) — nor a count of paints, a frame time, or per-second viewability.

2. **Gating, not counting.** A `WAITING` second (from the hook-derived state machine in `../source/tech-spec-v1.0.md` §3.3 and `../04-impression-engine.md`) is countable only if a liveness ping was received within the **gate window** `GATE_WINDOW_MS`:

   ```
   countable_second :=
       state == WAITING
       && session.tty_attested
       && !paused
       && (now - last_liveness_ping) <= GATE_WINDOW_MS
   ```

   The hook-derived `UserPromptSubmit → WAITING → Stop` interval supplies the *quantity* of countable seconds; the liveness gate only **admits or rejects** seconds inside that interval. Liveness pings alone, with no host hook interval to gate, produce **zero** impressions (this is what defeats "call `spnr-status` in a loop").

3. **`GATE_WINDOW_MS` is an empirically measured cadence constant, deliberately widened.** With `refreshInterval: 1` the expected cadence is a ~1 s tick plus message-boundary updates (~300 ms debounce), but it can slow or go absent under heavy streaming output and under #43826 — so the window must cover the ~1 s tick + debounce + jitter (start ~2 s) and be confirmed under load. `GATE_WINDOW_MS` is set from a measured cadence constant `C_cadence` (the observed p95 inter-invocation gap on real interactive sessions under load) plus margin:

   ```
   GATE_WINDOW_MS := C_cadence_p95 + margin     // published constant, NOT hardcoded-by-guess
   ```

   `C_cadence` MUST be measured before launch (see Consequences and `../source/tech-spec-v1.0.md` §15 Q2). Until measured, treat `GATE_WINDOW_MS` as an open value in `../12-risks-open-questions.md`, not a shipped default.

   > **Research correction:** the source spec's `render_heartbeat within last 2 s` gate is replaced by a **measured, published `GATE_WINDOW_MS`** derived from real cadence, because the ~300 ms-debounced, message-boundary firing means a fixed 2 s window would silently undercount on slow turns and (worse, given #43826) could drop seconds during legitimate waits. Undercounting is acceptable (invariant 3); building on a wrong cadence assumption is not.

4. **Server-side fraud scoring is the real moat — lean harder on it.** The liveness gate is a cheap front-line filter, not the proof. Economic truth remains server-side (invariant 4): **timing-distribution analysis** over signed, chained events does the heavy lifting — wait-interval length distributions (human turns are heavy-tailed log-normal; farms are uniform/periodic, KS-test distance), liveness-ping-to-hook coherence, TTY attestation rate, chain gaps/forks, device↔account graph. See `../05-fraud-attestation.md` and `../source/tech-spec-v1.0.md` §7. Forging *both* a plausible hook timeline *and* a plausible liveness cadence consistently still produces a distribution the fraud model targets.

5. **Honest advertiser claim.** The sellable property is **"attested + anomaly-filtered,"** never **"viewability-grade."** A liveness gate plus server fraud scoring is not IAB viewability and must never be marketed as such (see `../00-product-overview.md`, `../source/product-spec-v0.2.md` §5.6).

### State machine (gate overlaid on the hook-derived WAITING interval)

```
                 UserPromptSubmit                         Stop / timeout-close
   IDLE ───────────────────────────► WAITING ──────────────────────────────► IDLE
                                       │  ▲
                             PreToolUse│  │PostToolUse           (TOOL_RUNNING never counts)
                                       ▼  │
                                   TOOL_RUNNING

   per 1 s tick while WAITING:
   ┌───────────────────────────────────────────────────────────────────────┐
   │  liveness ping fresh? (now - last_ping <= GATE_WINDOW_MS)                      │
   │     ├─ yes ─► tick is countable  (subject to tty_attested && !paused)  │
   │     └─ no  ─► tick DROPPED        (undercount-safe, invariant 3)       │
   └───────────────────────────────────────────────────────────────────────┘

   impressions(interval) = floor(countable_seconds / 5)   // caps per §3.3 still apply
```

Note both transitions out of `WAITING` are honored: `Stop` **or** a timeout-close. Per the brief, `Stop` is **not** guaranteed exactly once per `UserPromptSubmit` (interrupts / API errors / blocking hooks can drop it), so the interval must also close on timeout — never assume clean bracketing.

---

## Consequences

### Positive

- **Robust to the known `statusLine` bugs.** When `statusLine` stops mid-session (#43826) or output is stripped, the gate simply stops admitting seconds → spnr **undercounts** rather than overcounts. This is invariant 3 working as designed; the failure direction is the safe one.
- **No false attestation claim.** We never assert a frame-level "render proof" we cannot construct (no frame timestamp exists), so we cannot be caught overstating to advertisers.
- **Headless fraud still blocked for free.** The CONFIRMED property (headless never invokes `statusLine`) is exactly what the gate keys on, so the cheapest fraud vector stays dead with no extra machinery.
- **Single clear dependency surface.** All `statusLine` fragility is now isolated behind one boolean (`is the last ping within `GATE_WINDOW_MS`?`), feeding a server model that is the actual moat.

### Negative / costs

- **Weaker single-signal viewability.** The client-side signal is now a coarse "alive recently," not a strong per-second proof. More of the trust burden shifts to the **server fraud model**, which must be correspondingly stronger and adversarially tested (`../08-testing-strategy.md` fraud red-team sims — heartbeat spammers must still land amber/red).
- **Measurement is a launch blocker for the constant.** `C_cadence` / `GATE_WINDOW_MS` MUST be empirically measured (spike) before paid campaigns. Shipping a guessed window risks systematic undercount (revenue loss) or, if too wide, admitting idle seconds (overcount — unacceptable). The measurement and the chosen published constant are tracked in `../12-risks-open-questions.md` and `../source/tech-spec-v1.0.md` §15 Q2.
- **More weight on the heavier server path.** ClickHouse feature materialization and the timing-distribution models are now load-bearing for fraud, not a backstop. Budget for that in `../05-fraud-attestation.md` and capacity planning.

### Neutral / follow-ups

- `../04-impression-engine.md` and `../source/tech-spec-v1.0.md` §2.2 / §3.3 must be reconciled to use the **gate** language (`liveness ping`, `GATE_WINDOW_MS`) and drop "render heartbeat == one paint."
- `spnr-status` keeps its OSC 8 **click** surface (the clickable shortlink) — but per the OSC 8 corrections (`../13-research-findings.md` §E, ADR-adjacent), clicks are a best-effort BONUS signal, server-attributed via `/c/{code}`, **not** core revenue. The liveness gate and the click surface are independent; degrade each separately.
- Time is always stamped on **daemon receipt**; host-supplied timestamps are never trusted for gating.

---

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| **Keep the per-frame render heartbeat** (source spec §2.2: each invocation == one paint, 2 s gate) | Factually wrong post-research: message-boundary + ~300 ms debounce firing, no frame timestamp, stops mid-session (#43826). A 2 s gate built on this silently mis-counts. |
| **Request an upstream frame-counter / per-paint hook from Anthropic** | **Rejected — depends on Anthropic.** It would re-create the exact platform-continuity risk we already carry on `spinnerVerbs` (a fragile, possibly-undocumented surface removable in one release with no deprecation guarantee; see `0004-platform-risk-adapter-abstraction.md`). We do not stake the fraud model on a primitive Anthropic has not committed to and could change or remove. |
| **Drop `statusLine` entirely, rely only on hooks + server scoring** | Loses the CONFIRMED, free headless-blocking property and the cheapest liveness front-line. We keep the gate precisely because the headless-never-invokes property is real and valuable. |
| **Build device-signed frame attestations** | Impossible: no frame-level timestamp exists in `statusLine` stdin. Cannot attest what the host does not expose. |
| **Trust `statusLine` cost/duration fields as viewability proxy** | They measure model cost/wall time, not human visibility; trivially farmable and orthogonal to "a human is watching." |

---

## References

- `../source/tech-spec-v1.0.md` §2.2 (superseded framing), §3 (impression engine), §7 (fraud), §15 Q2 (cadence measurement)
- `../source/product-spec-v0.2.md` §5.5–5.6 (impression engine, attestation/honesty note)
- `../04-impression-engine.md` · `../05-fraud-attestation.md` · `../03-protocol-SAP1.md`
- `../12-risks-open-questions.md` (GATE_WINDOW_MS open value, cadence spike) · `../13-research-findings.md` §A (host primitives, statusLine corrections), §E (OSC 8)
- `0004-platform-risk-adapter-abstraction.md` (why we do not depend on new upstream primitives)
- anthropics/claude-code #43826 (statusLine stops updating mid-session); OSC-8-stripping regressions (v2.1.3 / v2.1.42)
