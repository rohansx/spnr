# spnr — v0.1 De-Risking Spike Results

> Purpose: primary-source results of the four host-primitive spikes (S1–S4) run before committing to the v0.1 build.
> Status: Draft v0.3 · June 12, 2026 · Evidence: official Claude Code docs + the shipped 2.1.175 binary (`/home/rsx/.local/share/claude/versions/2.1.175`) + local micro-benchmarks on this machine.

These spikes validate the fragile host primitives the architecture rests on. **All four pass or resolve with a
concrete mitigation.** One (S3) surfaced a design unlock — `statusLine.refreshInterval` — that materially
strengthens the heartbeat primitive that research had flagged as the weakest assumption.

| Spike | Question | Result |
|---|---|---|
| S1 | Is `spinnerVerbs` real, what's its exact schema/limits? | ✅ **PASS** — schema confirmed from the binary itself |
| S2 | Is the hook hot-path within latency budget? Hook payload reality? | ✅ **PASS** — floor ~0.6 ms; better options found |
| S3 | Does `statusLine` give a usable "heartbeat"? | ✅ **RESCUED** — `refreshInterval: 1` gives a ~1 Hz tick |
| S4 | Does OSC 8 work as the statusline click surface? | ✅ **PASS** — officially supported (with a minor caveat) |

---

## S1 — `spinnerVerbs` schema & behavior ✅ PASS

**Confirmed from the shipped binary's own validation schema (strongest possible source):**

```
spinnerVerbs:k.object({mode:k.enum(["append","replace"]), verbs:…, excludeDefault:…})
H(){ let $=cfg().spinnerVerbs; if(!$) return DEFAULTS; if($.mode==="replace") … }
```

- ✅ Shape is the **object** `{ "mode": "replace" | "append", "verbs": [...] }` — plus an `excludeDefault` field
  observed in the schema. Not a bare array.
- ✅ Default verbs include `Pondering, Crafting, Thinking, Cooking, Noodling, Spelunking, …` (useful for the
  stock-verb restore snapshot).
- ✅ **No character/length limit** in docs — spnr's self-imposed ≤48-char rule stands as a safety constraint.
- ✅ **Not read-once-at-startup** — `spinnerVerbs` is absent from the docs' "A few keys are read once at
  session start" list, i.e. it is re-read live. > **Update vs spec:** mid-session rotation may in fact work; the
  read-at-startup + rotate-on-SessionStart + session-attribution design remains the safe default, with live
  rotation a non-load-bearing bonus.
- ✅ Precedence **Managed > CLI args > Local > Project > User** — project/local override user. v1 must detect a
  project/local `spinnerVerbs` override and serve no spinner impressions there (don't fight the user's config).

**Decision:** use `mode: "replace"` with our single sponsored verb; snapshot the user's prior `spinnerVerbs`
(and the stock defaults) for restore. No schema surprises.

## S2 — Hook hot-path & payload reality ✅ PASS (with better options)

**Local micro-benchmark (this machine):**

| Operation | Cost | vs budget |
|---|---|---|
| Process spawn floor (`/bin/true` ×300) | **~0.58 ms/spawn** | `spnr-hook` budget is ≤ 50 ms — **~85× margin** |
| Unix `SOCK_DGRAM` send+recv (×5000) | **~0.003 ms/op** | negligible |

So the spnr-hook *binary* floor is ~0.6 ms — the "~200 ms observed hook overhead" from research is **Claude
Code's own per-hook invocation machinery**, not our binary. Two findings reduce even that:

- ✅ **HTTP hooks exist** (`"type": "http"`, POST to a URL). spnr can point hooks at the **local daemon's
  loopback endpoint** instead of spawning `spnr-hook` per event → zero process spawn. > **Design option:** prefer
  an `http` hook to `127.0.0.1:<port>` (daemon) over a spawned binary; keep `spnr-hook` as the fallback.
- ✅ **Async hooks exist** (`"async": true`, also `asyncRewake`) → fire-and-forget without blocking the turn.
- ⚠️ **`UserPromptSubmit` blocks the session** (reduced 30 s timeout; "a stuck hook stalls the session"). spnr's
  wait-interval-open hook **must be `async` / instant** — never synchronous work there.
- ✅ **`Stop` fires exactly once per turn** ("when Claude finishes responding"). > **Update vs research:** the
  adversarial pass feared Stop wasn't once-per-turn; docs confirm it **is**, in the normal case. `Stop` can be
  *blocked* (exit 2 continues the conversation) and interrupts are undocumented → still **timeout-close** the
  wait interval for edge cases (the ≤60-impressions/interval cap already bounds it).
- ❌ **No `timestamp` field** in any hook payload (common fields: `session_id`, `hook_event_name`,
  `transcript_path`, `cwd`, `permission_mode`). → the daemon **stamps wall-clock + monotonic on receipt**
  (already required by the brief). `session_id` is present and stable → use it for the salted session fingerprint.
- ✅ `spnr-hook`/the http hook must always exit 0 / 2xx (exit 2 blocks for `UserPromptSubmit`/`Stop`/`PreToolUse`).

## S3 — `statusLine` heartbeat ✅ RESCUED via `refreshInterval`

**Confirmed cadence (official docs, verbatim):**

> "Your script runs **after each new assistant message**, after `/compact` finishes, when the permission mode
> changes, or when vim mode toggles. Updates are **debounced at 300 ms** … If a new update triggers while your
> script is still running, the in-flight execution is cancelled."

So statusLine is **message-boundary driven**, not per-paint — it does **not** repaint continuously *during* a
wait. This confirms the research correction: it is **not** a per-frame render heartbeat ([ADR-0002](adr/0002-statusline-as-coarse-liveness-gate.md)).

**The unlock — `refreshInterval`:**

> "The optional `refreshInterval` field **re-runs your command every N seconds** in addition to the event-driven
> updates. The minimum is `1`."

> **Design unlock:** spnr sets `statusLine` with **`refreshInterval: 1`** to obtain a **~1 Hz liveness tick**
> throughout a wait, not just at message boundaries. This gives the impression engine the per-second gate signal
> it needs and directly answers the "weakest assumption" in the research.

**Caveats that keep us honest (invariant 3):**
- `refreshInterval` is a **wall-clock timer** — it fires whether or not a human is actually watching. So a tick
  proves "an interactive TUI is mounted and Claude Code is running," **not** "a human is looking right now."
  → keep **presence-damping** (terminal focus / input-activity signals) to separate *watching* from *idle
  interactive session*; the tick is a **coarse liveness gate**, exactly as ADR-0002 specifies.
- ✅ Still confirmed: headless `claude -p` never mounts the TUI → never invokes statusLine → earns nothing.
- ⚠️ Known bugs remain a fragility (statusLine can go quiet mid-session, #43826) → undercount-safe, never
  overcount.
- stdin carries the base hook fields (incl. `session_id`) + cost/duration/model context; `spnr-status` reads a
  tmpfs cache and pings the daemon, staying inside its ≤10 ms budget (in-flight scripts are cancelled, so it
  **must** be fast — the cache-read design is correct).

> **Net for the impression engine:** heartbeat source = `statusLine` with `refreshInterval: 1` (≈1 Hz), gating
> seconds inside hook-derived `WAITING` intervals, damped by presence signals. `GATE_WINDOW_MS` starts at ~2 s
> (covers the 1 s tick + 300 ms debounce + jitter) and is finalized from a live measurement under load.

## S4 — OSC 8 click surface ✅ PASS (with a caveat)

**Confirmed from official statusline docs:**

> "**Links**: use OSC 8 escape sequences to make text clickable (Cmd+click on macOS, Ctrl+click on
> Windows/Linux). Requires a terminal that supports hyperlinks like iTerm2, Kitty, or WezTerm."

- ✅ OSC 8 is an **officially documented, supported** statusline feature → the click surface is sound (in the
  **statusline**, not the plain-text spinner).
- ⚠️ Caveat (verbatim): "Complex escape sequences (ANSI colors, OSC 8 links) can occasionally cause garbled
  output if they overlap with other UI updates." → clicks remain a **best-effort bonus**; revenue is
  impression-based, clicks server-attributed via `/c/{code}` ([06-money-settlement.md](06-money-settlement.md)).

---

## Remaining live experiments (deferred — need a controlled run, set up with the user)

These can't be measured without configuring the live host and observing a real interactive session; they are
**not blockers** for starting v0.1, but should run during the first slice:

1. **End-to-end hook overhead under load** — actual added latency of an `http`/`async` hook on `UserPromptSubmit`
   in a busy session (validate the "stalls the session" risk is fully avoided).
2. **statusLine behavior under heavy streaming output** — does the 300 ms debounce + `refreshInterval: 1`
   actually deliver a steady ~1 Hz tick during long tool-output streams? (sets `GATE_WINDOW_MS`).
3. **OSC 8 click through tmux / non-iTerm terminals** — confirm graceful degradation and tmux passthrough.

> These will be run as part of the [host replay harness](08-testing-strategy.md) and the editor-safety suite on
> the developer's own machine, not against the user's live working session.

## Net changes folded back into the docs

- [04-impression-engine.md](04-impression-engine.md) + [adr/0002](adr/0002-statusline-as-coarse-liveness-gate.md):
  heartbeat source is `statusLine refreshInterval: 1` (≈1 Hz), gated + presence-damped.
- [02-technical-spec.md](02-technical-spec.md) + [10-implementation-plan.md](10-implementation-plan.md):
  prefer an `http`/`async` hook to a loopback daemon endpoint over per-event binary spawn; `UserPromptSubmit`
  hook must be async; daemon stamps timestamps (no hook timestamp exists).
- [13-research-findings.md](13-research-findings.md) §1–3 / §11: statusLine verdict upgraded from "contradicts"
  to "coarse gate, rescued by refreshInterval"; Stop confirmed once-per-turn; OSC 8 confirmed supported.
