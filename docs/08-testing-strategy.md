# spnr — Testing Strategy

> How we prove spnr never harms the host, never overcounts, never leaks work product, and never lies to advertisers — before any of it ships.
> **Status:** Draft v0.3 · June 12, 2026

This document specifies the test suites, harnesses, and CI gates that enforce the [six invariants](02-technical-spec.md). It is organized around the principle that a small number of **sacred, release-blocking** suites carry the existential risks, while everything else is normal coverage. See [Architecture](01-architecture.md), [Impression Engine](04-impression-engine.md), [Fraud & Attestation](05-fraud-attestation.md), [Money & Settlement](06-money-settlement.md), and [Security & Privacy](07-security-privacy.md) for the systems under test.

---

## 0. Test taxonomy & where each suite runs

| Suite | Invariant defended | Type | Cadence | Blocks release? |
|---|---|---|---|---|
| **Editor-safety** | 1 (never degrade host) | property + crash-injection | every commit | **YES (sacred)** |
| **Egress canary** | 2 (never read work product) | runtime fixture + AST scan | every commit | **YES (sacred)** |
| **Host replay harness** | 3 (undercount) | deterministic golden-fixture | every commit | YES |
| **Fraud red-team sims** | 3, 4 | adversarial, against staging | nightly + pre-campaign | gates paid campaigns |
| **Reproducible-build** | 5 (open + reproducible) | byte-identical rebuild | every release | YES |
| **Hot-path size-check** | 1 (latency budget) | binary size assertion | every commit | YES |
| **Ledger zero-sum** | 4 (machine-honest economics) | invariant query | nightly + CI | YES |
| **Chaos** | 1, 6 | fault injection, against staging | nightly | no (alerts) |
| **Latency/cadence spikes** | 1, 3 | benchmark, sets constants | per-host-version | no (informs gates) |

Coverage target: **80%+ line+branch** across all client crates, with the editor-safety and content-firewall code paths held to **100%** (no untested branch may exist in code that writes the user's settings or parses host stdin).

---

## 1. The SACRED editor-safety suite

This is the one suite that, if it goes red, halts the release train unconditionally. It defends invariant 1 (**never degrade the editor/CLI**) and the settings-mutation state machine (`02-technical-spec.md` §2.3, mirrored here from `tech-spec-v1.0.md`).

### 1.1 Property: settings merge is a lossless round-trip

The contract: for **any** valid `settings.json`, `inject` then `restore` must return the file to a state that is **semantically equivalent** to the original, and byte-identical except for spnr-owned keys during the injected window.

```
property round_trip(original: ValidSettingsJson):
    snapshot   = snapshot(original)
    injected   = inject(original)          # writes spnr spinnerVerbs + statusLine
    restored   = restore(injected, snapshot)

    assert restored ==_semantic original   # all non-spnr keys preserved exactly
    assert spnr_keys_absent(restored)       # no residue
    assert key_order_preserved(restored)    # serde_json preserve_order path
    assert injected.spinnerVerbs == {"mode":"replace","verbs":[...]}  # object shape, NOT bare array
```

> **Research correction:** `spinnerVerbs` is an **object** `{ "mode": "replace"|"append", "verbs": [...] }`, not a bare array as some early drafts assumed. The generator and the assertions encode the object shape. See [13-research-findings.md](13-research-findings.md) §A.

Generator strategy (`proptest`, deny shrinking that escapes valid JSON):

| Generated dimension | Range / cases |
|---|---|
| Pre-existing `spinnerVerbs` | absent · bare-array (legacy hand-edit) · `{replace,...}` · `{append,...}` |
| Pre-existing `statusLine` | absent · string command · object with `command` |
| Key ordering | arbitrary permutations (round-trip must preserve order) |
| Unicode / nesting | emoji, RTL, deep nested objects, large arrays, duplicate-ish keys |
| Whitespace / formatting | tabs, CRLF, BOM, trailing commas rejected at boundary |
| Numeric edge | i64 max, floats, leading zeros, exponents |

> **Research correction:** the round-trip serializer for `settings.json` MUST use `serde_json` with `preserve_order`, and the **signing** canonical-JSON path (RFC 8785, `serde_jcs`/`serde_json_canonicalizer`) is a **separate, non-overlapping** code path. A property test asserts the two serializers are never used interchangeably (the settings path must never canonicalize; the signing path must never preserve_order). See [13-research-findings.md](13-research-findings.md) §F.

### 1.2 Project-level override is respected

```
property project_override_serves_nothing(user_settings, project_settings_with_spinnerVerbs):
    assert inject_decision(user_settings, project_settings) == SERVE_NOTHING
    assert user_settings unchanged   # we never touch global if project overrides
```

> **Research correction:** scope precedence is **Managed > Local > Project > User**, so a project-level `.claude/settings.json` *can* override the user's global. v1 detects a project-level `spinnerVerbs` and serves **no** spinner impressions in that project rather than fighting the user's config. See [13-research-findings.md](13-research-findings.md) §A.

### 1.3 Crash-injection: config never left sponsored > 60s

A test harness runs the daemon under a fault injector that issues `kill -9` at randomized points across the mutation state machine, then asserts recovery by any surviving binary (`spnr-hook` / `spnr-status` / next `spnrd` start) within the staleness window.

```
KILL POINTS (sampled uniformly across these instants):
  IDLE → SNAPSHOT      [before snapshot fsync]
  SNAPSHOT → INJECTED  [after tmp write, before rename(2)]
  INJECTED             [steady state, lock held]
  INJECTED → RESTORED  [after restore tmp write, before rename]
  during external-edit RE-MERGE debounce

INVARIANT ASSERTED AFTER EACH KILL:
  within ≤ 60s of lock-heartbeat going stale, some spnr binary
  observes (socket-fail ∧ lock.mtime > 60s) and RESTOREs the snapshot.
  → settings.json is NEVER observed in a sponsored state without a live daemon.
```

Verification mechanics:
- `rename(2)` atomicity means a kill mid-write leaves either the old file or the complete new file, never a torn one. The test greps for partial/torn JSON and fails if found.
- After kill, the test simulates the next hook/status invocation and asserts it performs the restore (restore is idempotent — running it twice is safe and tested).
- A "no live daemon ever" variant: kill the daemon and never restart it; assert the *first* subsequent `spnr-hook` call restores stock verbs.
- Time is injected via a clock seam, so "60s" is deterministic in CI (no real sleeping).

**Caps:** the suite runs ≥ 10,000 property cases and ≥ 2,000 crash-injection cases per CI run; a single failure blocks the merge. This suite is the literal gate for the v0.1 milestone ("editor-safety suite green", `tech-spec-v1.0.md` §14).

---

## 2. Host replay harness

Defends invariant 3 (**undercount, never overcount**). A fake Claude Code replays anonymized, **timing-only** hook + statusline fixtures into the real `spnr-hook` / `spnr-status` binaries and the daemon, then asserts the resulting impression count is deterministic and **≤ ground truth**.

### 2.1 Fixture format (timing-only, content-free)

```jsonc
// fixtures/replay/normal-coding-session.jsonl  — NO content fields, ever
{"t_ms": 0,     "kind": "hook",   "event": "SessionStart", "session": "s1"}
{"t_ms": 1200,  "kind": "hook",   "event": "UserPromptSubmit", "session": "s1"}
{"t_ms": 1250,  "kind": "status", "session": "s1"}          // render heartbeat
{"t_ms": 4300,  "kind": "hook",   "event": "PreToolUse",   "session": "s1"}
{"t_ms": 9100,  "kind": "hook",   "event": "PostToolUse",  "session": "s1"}
{"t_ms": 9150,  "kind": "status", "session": "s1"}
{"t_ms": 23800, "kind": "hook",   "event": "Stop",         "session": "s1"}
{"t_ms": 23850, "kind": "hook",   "event": "SessionEnd",   "session": "s1"}
// ground_truth: human-visible wait seconds with heartbeat coverage = 18
// expected_impressions = floor(18 / 5) = 3   (tool-running window excluded)
```

Fixtures are derived from synthetic timelines and anonymized real sessions stripped to `{t_ms, kind, event, session}`. The replay harness **structurally cannot** carry prompt/code/path text — see §3 (the same content-firewall guarantee the production path has).

### 2.2 Assertions

| Property | Assertion |
|---|---|
| Determinism | same fixture ⇒ identical impression count across 100 runs and across platforms |
| Undercount bound | `counted_impressions ≤ ground_truth_impressions` always (never `>`) |
| Tool time excluded | seconds inside `PreToolUse..PostToolUse` never count |
| Heartbeat gating | a wait second with no render heartbeat in its window does not count |
| Cap enforcement | per-interval ≤ 60, per-hour ≤ 600, per-day ≤ 4,000 honored |
| Single concurrent session | two overlapping sessions never double-count the same wall-second |

> **Research correction (timestamps):** the harness drives the daemon with the daemon's **own** receipt timestamps, not fixture-supplied ones. We do **not** trust hook-supplied timestamps in production (payload timestamp availability is inconsistent across host versions), so the harness validates daemon-stamped behavior. The `t_ms` in fixtures only sequences the replay; the daemon stamps on receipt. See [13-research-findings.md](13-research-findings.md) §A.

> **Research correction (Stop not guaranteed):** a dedicated fixture family drops `Stop` events (interrupt / API error / blocking-hook scenarios) and asserts the wait interval still closes via the timeout-close path with no overcount. We never assume clean `UserPromptSubmit`→`Stop` bracketing. See [13-research-findings.md](13-research-findings.md) §A.

> **Research correction (disableAllHooks):** a fixture with zero hook events (user set `disableAllHooks`) asserts the daemon accrues **nothing** and the host is unaffected — silent opt-out is a tested path, not an error. See [13-research-findings.md](13-research-findings.md) §A.

---

## 3. Egress canary tests (content firewall)

Defends invariant 2 (**never read work product**). This is the runtime side of the content firewall (`tech-spec-v1.0.md` §10.2); it is **sacred** and release-blocking.

### 3.1 Two enforcement layers

```
LAYER 1 — STATIC (AST scan, compile-time gate):
  walk the AST of crate `spnr-meta` (the JSONL timing reader)
  FAIL THE BUILD if any of these field names are referenced:
    content, message, text, tool_input, tool_response, prompt, completion
  spnr-hook's stdin extractor links NO general JSON deserializer (asserted: no serde_json
  derive on a stdin struct; hand-rolled key-skim only).

LAYER 2 — RUNTIME (canary egress capture):
  feed fixture transcripts seeded with UNIQUE canary secrets
  (e.g. "CANARY-7f3a9c-DO-NOT-EXFIL") into every reader/parser path,
  capture EVERY outbound byte (socket datagrams + HTTPS batch envelopes),
  ASSERT no canary token ever appears in any captured byte.
```

### 3.2 Canary corpus

| Field type | Example canary planted | Must never egress |
|---|---|---|
| `content` (assistant text) | `CANARY-content-…` | ✓ |
| `tool_input` (file paths, code) | `/home/CANARY-path-…` | ✓ |
| repo name / cwd | `CANARY-repo-…` | ✓ |
| prompt text | `CANARY-prompt-…` | ✓ |
| env var values | `CANARY-env-…` | ✓ |

The capture harness wraps the Unix datagram socket and a stub HTTPS endpoint, records the full byte stream, and runs a substring + entropy check for any planted canary. One leak = build fails. Outbound structs are closed-world (only the SAP wire types serialize), so any new field that could carry content forces a spec change and re-review.

---

## 4. Fraud red-team simulations

Defends invariants 3 and 4. Scripted adversaries run against **staging** nightly and as a hard gate before any paid campaign goes live. Each attacker must be scored **amber or red within its published detection window** (see [05-fraud-attestation.md](05-fraud-attestation.md)).

| Attacker | Technique | Expected detection | Window |
|---|---|---|---|
| Headless farm | `claude -p` loops, no TUI | **green earns 0** — no statusline → no heartbeats → no countable seconds | immediate (structural) |
| Heartbeat spammer | call `spnr-status` in a tight loop | heartbeats only *gate* seconds inside genuine hook-derived WAITING intervals; nothing to gate ⇒ no accrual | immediate |
| Replayer | resend captured signed events | chain `prev`/`ctr` mismatch ⇒ ULID dedup + fork flag | ≤ 1 ingest batch |
| Multi-account farm | many devices, shared payout address | device↔account graph + payout-address reuse | amber ≤ 24h |
| Timing forger | synthesize both hooks + heartbeats | uniform/periodic wait distribution vs human heavy-tailed log-normal (KS-distance) | amber/red ≤ 48h |

> **Research correction (fraud is the real moat, not viewability):** statusline is a **coarse liveness gate**, not a per-frame, per-paint heartbeat. It fires on **message boundaries with a ~300 ms debounce**, and the JSON carries **no frame-level timestamp** — so we cannot build frame-granularity "render attestation." The red-team suite therefore weights **server-side timing-distribution analysis** as the primary moat and treats heartbeat coverage as a coarse gate only. The advertiser claim under test is **"attested + anomaly-filtered," never "viewability-grade."** See [ADR-0002](adr/0002-statusline-as-coarse-liveness-gate.md) and [13-research-findings.md](13-research-findings.md) §A.

The "headless earns 0" rule is the one fraud guarantee that is structural (confirmed: headless `claude -p` does not invoke statusLine), so it is asserted in **both** the replay harness (§2) and the red-team suite (§4).

**Gate:** no paid campaign is enabled until the full red-team set lands amber/red within window on the current build. This gate is wired to the v0.2 milestone ("fraud sims passing", `tech-spec-v1.0.md` §14).

---

## 5. Chaos engineering

Defends invariants 1 and 6 (fail quiet, fail stock). Runs against staging nightly; failures alert but do not block (the *recovery* assertions inside do block if they regress in CI fixtures).

| Drill | Injection | Asserted outcome |
|---|---|---|
| CDN bad-signature poisoning | serve a creative with an invalid Ed25519 signature | client treats as network failure ⇒ cached creative within TTL ⇒ stock verbs; **arbitrary text never displayed** |
| Killswitch drill | flip signed killswitch flag at edge | every client restores stock verbs ≤ 60s; tested weekly in staging, monthly in prod |
| Ledger zero-sum nightly | full sum over `ledger_entries` | sums to zero; no `release` without matching `hold` (see §7) |
| Backend blackhole | drop all ingest | events queue to 10 MB bound, then oldest-drop with honest `gap` marker; flush on reconnect |
| Clock-skew | shift device clock ± hours | events outside ±5 min receipt window quarantined for review, never silently accrued |

> **Research correction (CDN compromise ≠ injection):** the bad-signature drill specifically proves that a compromised CDN **cannot become terminal injection** — invalid signature degrades to stock, it never renders attacker text. The signature key is pinned in the binary with one backup rotation key. See [07-security-privacy.md](07-security-privacy.md).

---

## 6. Empirical spikes from research (these set published constants)

Two measurement spikes are **prerequisites**, not optional benchmarks — their outputs become hard-coded gate constants and a default-on/opt-in decision.

### 6.1 Hook end-to-end latency benchmark → gates default-on vs opt-in

> **Research correction:** "fire-and-forget is free" is **false**. Observed hook invocation overhead can be **~200 ms** in some setups. The `spnr-hook` design (datagram to socket, exit) is correct, but real end-to-end latency must be **measured before default-on**. See [13-research-findings.md](13-research-findings.md) §A.

```
BENCHMARK: measure added wall-clock latency Claude Code attributes to a hook
  baseline    = host turn latency with no spnr hooks
  with_spnr   = host turn latency with spnr-hook registered
  delta_ms    = with_spnr - baseline   (p50, p95, p99 across ≥ 1000 turns,
                                         per host version, per platform)

DECISION GATE (the spike's deliverable):
  if p95 delta_ms ≤ 25 ms   → ship hooks DEFAULT-ON
  if p95 delta_ms 25..100   → ship OPT-IN; investigate HTTP-hook path
  if p95 delta_ms > 100      → DO NOT ship hook-based path default; reassess
```

The hot-path budgets remain hard asserts regardless: `spnr-hook` exit ≤ 50 ms (10 ms typical), `spnr-status` exit ≤ 10 ms (`tech-spec-v1.0.md` §1). The benchmark measures *host-attributed* latency, which is the user-perceptible quantity and the thing that decides default-on.

### 6.2 Statusline invocation-cadence measurement → sets the gate-window constant

> **Research correction:** statusLine is **not** invoked per-frame. It fires on **message boundaries with a ~300 ms debounce**, can **stop updating mid-session** after the first response (issue #43826), and has had **OSC-8-stripping regressions** (v2.1.3 / v2.1.42 era). Output is fragile. See [ADR-0002](adr/0002-statusline-as-coarse-liveness-gate.md).

```
MEASUREMENT: instrument spnr-status to log invocation timestamps across
  representative sessions (light output, heavy streaming output, long tool runs).

DERIVED CONSTANT (open question §15 Q2 of tech-spec):
  GATE_WINDOW_MS = ceil(p95 inter-invocation gap) widened by a safety margin
    so a genuinely-live session is never starved of countable seconds by
    debounce/throttle, while a dead pane still accrues nothing.
  Publish GATE_WINDOW_MS as a versioned constant in the SAP/1 spec.

REGRESSION GUARD:
  the §2 replay harness pins GATE_WINDOW_MS; if a host version changes cadence,
  cadence measurement re-runs and the constant is re-published (not silently changed).
```

The original spec used a fixed 2s heartbeat window; the measured constant replaces that magic number. See [04-impression-engine.md](04-impression-engine.md) for how `GATE_WINDOW_MS` enters the per-second accrual rule.

---

## 7. CI gates (the merge/release blockers)

A merge to `main` requires all of the following green; a release tag additionally requires the reproducible-build and ledger zero-sum gates.

| Gate | What it runs | Fails the build when |
|---|---|---|
| **editor-safety** | §1 property + crash-injection (≥10k + ≥2k cases) | any round-trip non-equivalence, torn write, or config sponsored > 60s post-kill |
| **egress-canary** | §3 AST scan + runtime canary capture | any forbidden field referenced, or any canary token in outbound bytes |
| **reproducible-build** | rebuild from `--locked` pinned toolchain (musl, `cargo-zigbuild`; macOS universal2 via `lipo`), compare BLAKE3 | rebuilt artifact hash ≠ published hash |
| **hot-path size-check** | strip + measure `spnr-hook`, `spnr-status` | either binary > 1 MB stripped (full binaries > 10 MB) |
| **ledger zero-sum** | sum `ledger_entries` over a seeded ledger | non-zero sum, or `release` without matching `hold` |
| host-replay (§2) | golden-fixture impression counts | nondeterminism or any `counted > ground_truth` |

> **Research correction (reproducible-build signing):** the build/release gate verifies **zipsign (ed25519)** as used by `self_update`, **not minisign**, OR a hand path that downloads then verifies with `minisign-verify` before swapping the binary (with `self_update`'s sig feature disabled). The earlier assumption that `self_update` checks minisign out of the box is wrong — the gate tests whichever path we actually ship. See [13-research-findings.md](13-research-findings.md) §F and [09-repo-build-layout.md](09-repo-build-layout.md).

> **Research correction (hot-path size is achievable, not free):** the <1 MB stripped budget holds **only** if `spnr-hook`/`spnr-status` stay dependency-lean (`std::os::unix::net::UnixDatagram` + `blake3` + minimal), with heavy deps (`keyring`, `notify`, `tokio`, `self_update`) isolated in `spnrd`. The size-check gate is what keeps that discipline honest; `panic=abort` + `opt-level=z` are required. See [09-repo-build-layout.md](09-repo-build-layout.md).

---

## 8. Coverage, environments, and what we do NOT test

### 8.1 Coverage

- Target **80%+** line+branch on all client crates (`cargo-llvm-cov`).
- **100%** on `spnr-meta` (content firewall), the settings-mutation state machine, and the restore/staleness path — these defend the two existential invariants and may carry no untested branch.
- Coverage is reported but the editor-safety and egress-canary gates are the hard blockers; a high coverage number with a red sacred suite never ships.

### 8.2 Test environments

| Tier | What | Where |
|---|---|---|
| unit + property | per-crate logic, merge/round-trip | CI, every commit, hermetic |
| replay/integration | real binaries + daemon + socket, timing fixtures | CI, every commit |
| staging adversarial | fraud sims, chaos, killswitch | nightly against staging stack |
| host-version matrix | latency + cadence spikes | per Claude Code release (currently 2.1.175) |

> **Research correction (fragile host surface):** because `spinnerVerbs` may be undocumented/informally shipped and removable in a single release with no deprecation guarantee (ref `anthropics/claude-code` #21599), the host-version matrix re-runs §6 on every new Claude Code version and a dedicated test asserts the `HostAdapter` statusline-only fallback still functions if the spinner adapter is force-disabled. See [ADR-0004](adr/0004-platform-risk-adapter-abstraction.md) and [12-risks-open-questions.md](12-risks-open-questions.md).

### 8.3 Explicitly out of scope (and why)

- **Viewability-grade attestation tests** — we do not test for what we do not claim. There is no frame-level render timestamp; building a "viewability" assertion would be testing a lie. The claim is "attested + anomaly-filtered."
- **Mid-session creative rotation** — the impression model attributes one creative per session (read-at-startup), so there is no rotation path to test. Hot-reload, if it exists, is a non-load-bearing bonus and is not relied on by any test. See [04-impression-engine.md](04-impression-engine.md).
- **API-credit-code redemption** — there is no such code path to test; redemption tests cover gift-card/local-payout rails only (Tremendous sandbox), per [ADR-0001](adr/0001-payout-default-gift-cards-not-api-credits.md).

---

## 9. Open testing questions

- Exact per-host-version hook payload field availability and timestamp presence — pin against a tested version matrix; tracked in [12-risks-open-questions.md](12-risks-open-questions.md).
- Whether statusline cadence is throttled under heavy streaming output enough to need a wider `GATE_WINDOW_MS` than §6.2 measures on a quiet session — measure under load before locking the constant.
- Tremendous sandbox coverage for India redemption end-to-end (idempotency, ~1–2 business-day production approval lag) — must be green before the v0.1 day-one-redemption milestone. See [06-money-settlement.md](06-money-settlement.md).

*testing-strategy ends — Draft v0.3, June 12, 2026*
