# 07 — Security & Privacy Engineering

> Threat model, the mechanical content firewall, privacy posture, signed killswitch, anti-phishing, and the hard PLATFORM-RISK constraints that keep spnr inside sanctioned territory.
> Status: Draft v0.3 · June 12, 2026

Companion docs: [Architecture](01-architecture.md) · [Technical Spec](02-technical-spec.md) · [SAP/1 Protocol](03-protocol-SAP1.md) · [Fraud & Attestation](05-fraud-attestation.md) · [Money & Settlement](06-money-settlement.md) · [Testing Strategy](08-testing-strategy.md) · [Risks & Open Questions](12-risks-open-questions.md) · [Research Findings](13-research-findings.md). ADRs: [0002 statusline gate](adr/0002-statusline-as-coarse-liveness-gate.md), [0004 platform-risk adapter](adr/0004-platform-risk-adapter-abstraction.md), [0005 naming & domains](adr/0005-naming-and-domains.md).

This document governs invariants **2** (never read work product) and **5** (everything on the user's machine is open source and reproducible), and is the security half of invariant **4** (network assumes every client is hostile). See [02-technical-spec.md](02-technical-spec.md) §0 for the full invariant list.

---

## 1. Threat model

The asset spnr protects, in priority order: (1) the user's editor/CLI must never degrade, (2) the user's work product must remain structurally unreadable, (3) advertiser trust in impression counts, (4) accrued user balances. Everything below derives from those.

| # | Threat | Attacker | Control | Residual risk |
|---|---|---|---|---|
| T1 | Malicious creative → terminal escape / ANSI injection | compromised CDN, malicious advertiser | charset allow-list both ends (`^[\p{L}\p{N} —.,:'&+/↗-]{1,48}$`); client strips ANSI bytes then **rejects** on mismatch; creatives Ed25519-signed, key pinned in binary; CDN compromise ≠ injection | terminal-specific escape outside allow-list (mitigated by reject-on-mismatch) |
| T2 | `settings.json` corruption / left in sponsored state | crash, concurrent writer, power loss | atomic write→fsync→`rename(2)`; pre-injection snapshot to `~/.spnr/backup.json`; **idempotent restore by any spnr binary**; inotify/FSEvents re-merge of spnr-owned keys only | host changes settings schema (→ abort + restore + PAUSED) |
| T3 | Auth token / device-key theft | local malware, backup exfiltration | OS keychain (Secret Service / macOS Keychain); 24 h access tokens with refresh rotation; **keychain stores an encrypted-at-rest, *readable* blob — not a hardware-bound non-exportable key** (see §1.1) | local root or unlocked-keyring malware can read the blob; hardware-bound mode is a separate track |
| T4 | Supply-chain tamper of the installed binary | poisoned release, MITM | reproducible builds (`--locked`, pinned toolchain, musl); published **BLAKE3** hashes; **minisign-signed** release manifests verified with `minisign-verify` (see §1.2 — `self_update` does NOT do this for us); install script ≤ 100 lines, version-pinned | trust-on-first-install of the pinned pubkey |
| T5 | Payout phishing (spnr.com is a third-party squat) | lookalike redemption page | single canonical login/redemption host; `spnr login`/`spnr redeem` open the **exact** URL from the CLI; "we operate only on spnr.sh/.dev/.co" in README + every email; lookalike monitoring | user pastes a phished URL into a browser unprompted |
| T6 | Local socket abuse by other processes | another local user/process writing to the daemon socket | `~/.spnr` dir mode **0700**; versioned datagram schema; daemon treats all socket input as untrusted, rate-limited, fixed-size | same-uid process can still spam (bounded by rate limit + caps) |
| T7 | Server breach → retroactive event forgery | attacker with backend DB access | **client-side signing**: historical events cannot be forged without per-device private keys; per-device hash chain + monotonic counter; ledger append-only with offsite WAL archive | future events for *new* sessions could be fabricated only with a stolen device key (T3) |
| T8 | Platform retaliation (surface removed / account action) | Anthropic ToS enforcement or PR shutdown | official binary only; no OAuth token export; no request routing; no telemetry suppression; `HostAdapter` fallback; sponsored disclosure (see §6) | discretionary brand/PR shutdown remains possible — treated as existential, see §6 |

> **Research correction:** The source specs claimed the device key is *"non-exportable where platform allows"* (tech-spec §10.1) and described "signed releases, pinned install script" via tooling assumed to pair cleanly. Both were over-stated. T3 and T4 below correct them. See [13-research-findings.md](13-research-findings.md) §F.

### 1.1 T3 corrected — keyring stores a readable encrypted-at-rest blob

The `keyring` crate (v4.0.1) does **not** produce non-exportable, Secure-Enclave-bound keys. It stores a secret **blob** that the OS keychain encrypts at rest and returns in plaintext to any process that satisfies the keychain's unlock policy under the same user. The real threat model is therefore:

| Property | Reality with `keyring` 4.0.1 |
|---|---|
| Encrypted at rest | Yes (OS keychain) |
| Bound to hardware / non-exportable | **No** |
| Readable by same-user process when keychain unlocked | **Yes** |
| Readable by local root / disk image of locked keychain | Generally no (depends on OS keychain crypto) |

```
Stored secrets (both as readable blobs in OS keychain):
  spnr.auth.token   → 24h access token (refresh-rotated)
  spnr.device.key   → Ed25519 private key (device identity)
```

Consequences we design around:
- **Blast radius is one device.** A stolen `spnr.device.key` lets an attacker sign events *as that device only*. Server-side fraud scoring (timing distribution, [05-fraud-attestation.md](05-fraud-attestation.md)) catches anomalous emission from a cloned key; payouts sit on a 7-day rolling hold so theft is recoverable, not instantly cashable.
- **Token theft is time-boxed.** 24 h access tokens + refresh rotation cap the window; a stolen refresh token is revocable server-side on the next `spnr status`/login.
- **Hardware-bound mode is a SEPARATE, platform-specific hardening track**, not v1. True non-exportable keys require the abandoned `keychain-services` crate or hand-rolled `security-framework` FFI + codesigning on macOS, and a TPM/PKCS#11 path on Linux. Tracked in [12-risks-open-questions.md](12-risks-open-questions.md); do not claim it ships in v1.

> **Research correction:** "non-exportable keys" is FALSE for the `keyring` crate. Downgrade the claim to "OS-keychain-protected, encrypted-at-rest." See [13-research-findings.md](13-research-findings.md) §F.

### 1.2 T4 corrected — self_update verifies zipsign, not minisign

The release-signing story in the source spec assumed `self_update` would verify our minisign releases out of the box. It does not. `self_update` (0.44.0) verifies **zipsign (ed25519)** archives, not minisign. The two signature formats are not interchangeable.

Two viable paths; spnr chooses **(B)** for v1 so the verification key is the same one used elsewhere and the audit story is a single tool:

| Path | How | Trade-off |
|---|---|---|
| (A) Native zipsign | Sign release archives with `zipsign`, let `self_update` verify | One tool does fetch+verify+swap; ties us to zipsign archive format |
| (B) **Manual verify-then-replace (chosen)** | Disable `self_update`'s signature feature; download manifest + binary; verify BLAKE3 hash + **minisign** signature with `minisign-verify` (0.2.5) ourselves; only then atomically replace the binary | Same minisign key as published release hashes; explicit, auditable; we own the swap |

```
self-update (spnrd, path B):
  poll  cdn.spnr.sh/release/{channel}/manifest.minisig + manifest.json
  verify  minisign-verify(manifest.json, pinned_minisign_pubkey)   # FAIL → abort, keep current
  fetch   binary  → tmp in same dir as install target
  check   blake3(binary) == manifest.blake3                        # FAIL → abort, delete tmp
  swap    fsync(tmp) → rename(2) over current binary               # atomic; never elevates privileges
  channels: stable | canary ; staged rollout % decided server-side
```

> **Research correction:** `self_update` verifies zipsign (ed25519), not minisign, so the spec's "minisign-signed releases" + `self_update` pairing does not work out of the box. We disable `self_update`'s sig feature and verify with `minisign-verify` ourselves. See [13-research-findings.md](13-research-findings.md) §F.

> Two signing/serialization code paths must stay non-overlapping: **canonical JSON for SAP/1 event signing** (RFC 8785, via `serde_jcs`/`serde_json_canonicalizer`) and the **settings.json round-trip** (`serde_json` with `preserve_order`). They never share a serializer. See [03-protocol-SAP1.md](03-protocol-SAP1.md).

---

## 2. The content firewall (invariant 2, made mechanical)

Invariant 2 — *never read work product* — is not a policy; it is enforced by code structure, a CI AST deny-list, and a runtime egress canary. Three layers:

### 2.1 Layer 1 — restricted hook extractor (`spnr-hook`)

`spnr-hook` receives host hook payloads on stdin. It links **no** general JSON deserializer for stdin. A hand-rolled extractor pulls **exactly three** top-level fields and ignores every other byte:

```
extract(stdin_bytes) -> HookDatagram {
    hook_event_name : &str,   // e.g. "SessionStart"
    session_id      : &str,   // raw id, salted-hashed before it ever leaves the machine
    timestamp       : i64,    // host-provided; NOT trusted (see below)
}
// Everything else on stdin (tool_input, prompt, transcript_path, cwd, …)
// is never deserialized and never copied.
```

Hard rules:
- The struct above is the **only** thing constructable from stdin. There is no field for `content`, `message`, `text`, `prompt`, `cwd`, `transcript_path`, or any work-product surface.
- **Host timestamps are not trusted.** The daemon stamps every event on **receipt** (monotonic + wall-clock at `spnrd`), because payload timestamp availability is inconsistent across Claude Code versions. The extracted `timestamp` is at most a sanity cross-check, never the billing clock.
- `spnr-hook` is dependency-lean (std `UnixDatagram` + minimal) to keep it < 1 MB stripped and exit ≤ 50 ms.

> **Research correction:** Do NOT rely on hook-supplied timestamps; stamp on daemon receipt. Payload timestamp availability is inconsistent across host versions, and `Stop` is not guaranteed to fire once per `UserPromptSubmit`. See [13-research-findings.md](13-research-findings.md) §A and [04-impression-engine.md](04-impression-engine.md).

### 2.2 Layer 2 — `spnr-meta` crate: CI AST deny-list

The JSONL session-metadata reader (a reconciliation cross-check, **not** primary counting) lives in its own crate `spnr-meta`. Its parser is structurally incapable of producing strings from work-product fields, and a CI gate enforces this:

```
CI gate: ast-denylist (blocks release on any hit)
  walk spnr-meta crate AST
  DENY if any identifier / string literal references:
      content | message | text | prompt | completion | code
      | transcript | cwd | file_path | repo | path
  → build fails; no exceptions list (add a field ⇒ change the published SAP spec first)
```

The deny-list is a **closed** list of field names that may never be referenced anywhere in `spnr-meta`. There is no allow-override; the only way to read a new field is to amend [03-protocol-SAP1.md](03-protocol-SAP1.md) and pass review.

### 2.3 Layer 3 — runtime egress-canary harness

A runtime test (also a CI gate, also part of [08-testing-strategy.md](08-testing-strategy.md)) proves the firewall empirically:

```
egress-canary harness:
  1. plant unique canary secrets in fixture transcripts / hook payloads
       e.g.  CANARY-a1b2c3  in content, prompt, cwd, file paths
  2. run the full client (spnr-hook + spnr-meta + spnrd) against the fixtures
  3. capture EVERY outbound byte (socket + HTTPS egress tap)
  4. ASSERT no canary substring appears in any outbound byte, ever
  → any leak fails the build
```

This catches accidental leakage that an AST scan cannot (e.g., a canary smuggled through a length field or a hash that wasn't salted).

### 2.4 Closed-world outbound schema

The wire is closed-world: the SAP/1 wire structs in `spnr-proto` are the **only** serializable outbound types. There is no dynamic/`serde_json::Value` passthrough on the egress path. Adding any field to the wire requires changing the published SAP/1 spec — which is reviewable and public.

```
outbound types (exhaustive, from spnr-proto):
  SignedEventBatch { envelope_sig, events: Vec<Event> }   // §4.2 of SAP/1
  Event { v, id(ULID), ctr, prev(blake3), t, type, session(salted-hash), creative, n }
  ServeRequest { device, adapter }
  FundOrPayoutEnvelope { … }   // money paths, see 06-money-settlement.md
  InstallMeta { os, arch, version, adapter }
// No free-form string field anywhere references work product.
```

---

## 3. Privacy posture (exhaustive)

The schema **is** the privacy policy. `spnr audit` dumps the raw outbound queue human-readably so any user can verify the lists below against real traffic.

### 3.1 Collected (closed list)

| Datum | Where defined | Why |
|---|---|---|
| Signed ad events: `{type, creative_id, surface, dedup id (ULID), ctr, prev-hash, salted session fingerprint, timestamp, n}` | SAP/1 §4.2 ([03-protocol-SAP1.md](03-protocol-SAP1.md)) | impression/click accounting + fraud scoring |
| Install metadata: `{os, arch, binary version, adapter}` | InstallMeta | self-update targeting, support |
| Account email | login | crediting, redemption delivery |
| Server-side click record at redirect: `{creative, device_pub_short, ts, ip_class, ua}` | edge `/c/{code}` | server-attributed clicks (never client-reported as billable) |

`session` is a **salted hash**; the salt is device-local and the raw `session_id` never leaves the machine.

### 3.2 Never collected (structurally, not by promise)

```
NEVER: code · prompts · completions · model output · file paths · repo names
       transcript content · environment variables · hostnames · usernames
       cwd · git remotes · any free-form text from the host
```

These are enforced by §2 (firewall), not by a privacy clause. There is no code path that can read them.

### 3.3 Open source & reproducible

Every byte that runs on the user's machine is open source (AGPL-3.0 client + protocol) — the actual built artifact, reproducible builds with published BLAKE3 hashes, not a mirror. The backend auction + attestation verifier are open-sourced as the SAP/1 reference; only ops glue stays private. See invariant 5 and [09-repo-build-layout.md](09-repo-build-layout.md).

---

## 4. Signed killswitch

A signed killswitch can blank creatives network-wide and revoke a hostile creative id, fast, without a client update.

```
killswitch states (signed flag at CDN edge + /v1/serve):
  global_blank  → serve payload = null         → all clients restore stock verbs (fail-stock)
  revoke(cr_id) → creative id rejected fleet-wide → clients drop it, rotate to stock if active

Trust model:
  - killswitch flag is Ed25519-signed; clients verify against the pinned serve key
  - invalid/absent signature ⇒ treated as network failure ⇒ cached creative within TTL → stock
  - propagation target: ≤ 60 s (CDN cache TTL bound)
  - tested weekly in staging; drilled monthly in prod
```

A killswitch can only **remove** content (revert to stock verbs). It can never inject content — a compromised killswitch channel degrades to "everyone sees stock spinner," which is the safe state (invariant 6). See [11-phases-roadmap.md](11-phases-roadmap.md) for the kill-drill acceptance criteria and [02-technical-spec.md](02-technical-spec.md) for the serve-time signature detail.

---

## 5. Anti-phishing & domain posture

Because the product moves money, the obvious attack is a cloned redemption page on a lookalike host. Mitigation is "one canonical host + CLI opens exact URLs so the user never types one."

| Domain | Status (June 12, 2026) | Posture |
|---|---|---|
| `spnr.sh` | **AVAILABLE — register immediately** | intended canonical identity + `get.spnr.sh` installer |
| `spnr.co` | **AVAILABLE — register immediately** | intended advertiser/redemption portal |
| `spnr.dev` | registered (Porkbun, 2023-12-06, 502) — **ownership UNVERIFIED** | confirm whether founder-owned before relying on it for docs/protocol |
| `spnr.com` | third-party parked since 2006 (expires 2026-09-17), **not ours**, squat/impersonation risk | never link; monitor; "we operate only on spnr.sh/.dev/.co" in README + every email |

> **Research correction:** The source specs treated spnr.sh / spnr.co / spnr.dev as already "owned." Research refuted this: spnr.sh and spnr.co are **unregistered/available** (register now), and spnr.dev's ownership is **unverified**. See [adr/0005-naming-and-domains.md](adr/0005-naming-and-domains.md) and [13-research-findings.md](13-research-findings.md) §J.

Anti-phishing controls (independent of which domains we secure):
- Login and redemption live on **one** canonical host only.
- `spnr login` and `spnr redeem` **open the exact URL** from the CLI; users never type or paste an auth/redemption URL.
- Every auth email and the README state the canonical hosts verbatim.
- The click shortlink (`/c/{code}`) is the only user-facing URL the system emits at scale, and it is strictly server-side URL-allow-listed (see [04-impression-engine.md](04-impression-engine.md) §OSC-8 and below).

---

## 6. PLATFORM-RISK hard constraints (non-negotiable)

These exist because the Jan–Apr 2026 Anthropic enforcement crackdown targeted third-party harnesses that **exported OAuth subscription tokens and spoofed the official client to route Claude requests** for billing/rate-limit arbitrage. spnr does none of that — it only edits the local `spinnerVerbs` display setting using the unmodified official binary. That precedent does **not** transfer to spnr. But the constraints below are what keep it that way, and violating any one of them would re-create the precedent.

> **Research correction:** Downgrade "Anthropic will likely shut this down" to "unadjudicated gray area, but real." The crackdown's triggers (token export, request routing, telemetry spoofing) are precisely what spnr must never do. See [13-research-findings.md](13-research-findings.md) §B and [adr/0004-platform-risk-adapter-abstraction.md](adr/0004-platform-risk-adapter-abstraction.md).

| Constraint | Rule | Enforcement |
|---|---|---|
| **Official binary only** | spnr runs *alongside* the unmodified official Claude Code / Codex CLI; never patch, repackage, or proxy it | code review; no host-binary dependency in any crate; `HostAdapter` only reads hooks/statusline + writes `spinnerVerbs` |
| **NO OAuth token export** | never read, store, transmit, or derive value from the host's OAuth/subscription tokens | firewall (§2) has no code path to host credential files; egress-canary fixtures include fake OAuth tokens that must never appear outbound |
| **NO request routing** | never intercept, proxy, replay, or rate-limit-arbitrage Claude/Codex model requests | spnr has no network path to model endpoints; it talks only to spnr backend + the CDN |
| **NO telemetry / heartbeat suppression** | never suppress, spoof, or delay the host's own telemetry or heartbeats (this WAS a detection trigger) | spnr writes only `spinnerVerbs` + (opt-in) statusline; it never edits host telemetry config or intercepts host network |

Additional standing constraints (architecture-level, tracked under platform risk):
- **Clear sponsored disclosure** (FTC 16 CFR Part 255): the spinner copy carries the brand; statusline/portal disclose "sponsored." See [00-product-overview.md](00-product-overview.md).
- **Surface continuity is fragile.** `spinnerVerbs` is possibly-undocumented and removable in one release with no deprecation guarantee. Mitigated by the `HostAdapter` trait + statusline-only fallback. Read-at-startup, rotate-on-SessionStart — never depend on mid-session hot-reload.
- **Discretionary brand/PR shutdown remains possible.** Anthropic publicly committed (Feb 2026) to keeping Claude ad-free; a visible third-party spinner-ad network could be killed for optics. Treat as existential: keep burn low, ship behind the adapter, and **have a plan that does not strand accrued user balances if the surface vanishes** (see [06-money-settlement.md](06-money-settlement.md) and [12-risks-open-questions.md](12-risks-open-questions.md)).
- **Watch Kickbacks.ai.** Anthropic's first reaction to Kickbacks is the single highest-signal data point on tolerance; monitor and record it.

> **Research correction:** `spinnerVerbs` may be undocumented/informally shipped (ref anthropics/claude-code issue #21599) and is the core continuity risk; statusLine is a coarse liveness gate, not a per-frame heartbeat, and has had OSC-8-stripping regressions. The honest advertiser claim is "attested + anomaly-filtered," never "viewability-grade." See [adr/0002-statusline-as-coarse-liveness-gate.md](adr/0002-statusline-as-coarse-liveness-gate.md), [05-fraud-attestation.md](05-fraud-attestation.md), and [13-research-findings.md](13-research-findings.md) §A, §E.

---

## 7. Click-surface URL safety (OSC 8)

Clicks are a best-effort **bonus** signal carried by the **statusline** OSC 8 hyperlink — never the spinner (`spinnerVerbs` is plain-text only, not clickable). Revenue accounting is impression-based; clicks are server-attributed via the `/c/{code}` redirect.

- Emit the close sequence `ESC]8;;ST`; keep redirect URLs short (< 2083 bytes, bytes 32–126 only).
- **Strict server-side URL allow-listing** on the advertiser destination resolved by `/c/{code}` — the client never carries the raw advertiser URL, only the short code, so a spoofed client cannot redirect users to an arbitrary destination.
- OSC 8 is operationally fragile inside Claude Code (stripping regressions; tmux/Konsole failures) — degrade silently to plain text. See [13-research-findings.md](13-research-findings.md) §E and [04-impression-engine.md](04-impression-engine.md).

> **Research correction:** The spinner is NOT clickable; the click surface is the statusline OSC 8 link, and clicks are best-effort bonus, not core revenue. See [13-research-findings.md](13-research-findings.md) §E.

---

## 8. Open security questions

Tracked in [12-risks-open-questions.md](12-risks-open-questions.md):
- Hardware-bound key mode (Secure Enclave / TPM / PKCS#11) — separate platform-specific hardening track; not v1.
- Whether to ship a defensive registration / monitoring contract for `spnr.com` (squat, expires 2026-09-17).
- Pinned-key trust-on-first-install: distribution of the minisign + serve pubkeys without a TOFU window.
- USDC rail security/custody (MPC/HSM hot wallet, segregated escrow) is owned by [06-money-settlement.md](06-money-settlement.md); the legal MSB/MTL gate precedes enabling it.
