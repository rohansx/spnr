# SAP/1 — Spinner Ad Protocol

> The open RFC for spnr's device-signed event & attestation wire protocol. Published canonically at `spnr.dev/spec`.
> Status: Draft v0.3 · June 12, 2026

SAP/1 defines how a spnr client on a developer's machine establishes a pseudonymous device identity, emits **signed, hash-chained, idempotent** ad events, and ships them to the spnr ingest endpoint, where they become the sole basis of economic truth. It is deliberately small and closed-world: the wire structs are the entire protocol surface. If a field is not in this document, it is not on the wire.

This document is the normative reference. For the surrounding system see [01-architecture.md](01-architecture.md); for how impressions are *derived* before they are signed see [04-impression-engine.md](04-impression-engine.md); for the server-side fraud bands that consume these events see [05-fraud-attestation.md](05-fraud-attestation.md); for the ledger and settlement that the accepted events drive see [06-money-settlement.md](06-money-settlement.md).

The keywords MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are used per RFC 2119/8174.

---

## 1. Scope, versioning & governance

### 1.1 Scope

SAP/1 covers, and only covers:

1. Device identity establishment (§3).
2. The canonical event object and its closed-world schema (§4).
3. Canonical byte encoding for signing (§5).
4. Ed25519 signing and the batch ingest envelope (§6).
5. The server verification pipeline that admits or rejects events (§7).
6. Click attribution, which is explicitly **server-side** and NOT an event the client signs (§8).
7. Client-side durable queue semantics (§9).

SAP/1 does NOT cover creative delivery (a separate signed CDN response, see [01-architecture.md](01-architecture.md) §creative), the auction, the ledger entry format, or redemption — those are spnr backend concerns, not protocol-on-the-wire concerns.

### 1.2 Versioning

- The protocol major version is carried in **two** places that MUST agree: the event field `v` (integer, currently `1`) and the ingest path (`/v1/ingest`).
- A breaking change to the event schema, the canonical encoding, or the verification pipeline increments the major version (`v: 2`, `/v2/ingest`). The server MUST run old and new majors side by side for a deprecation window of ≥ 90 days.
- Additive, backward-compatible changes (e.g., a new `type` enum value the server already tolerates) do NOT bump the major. Because the wire is closed-world (§4.6), adding a *field* is always breaking and always bumps the major.
- Clients send exactly one `v`. The server MUST reject a batch whose events mix `v` values.

### 1.3 Governance

- The canonical text lives in the `spec/` directory of the spnr workspace (see [09-repo-build-layout.md](09-repo-build-layout.md)) and is published verbatim at `spnr.dev/spec`. The published HTML is byte-pinned to a git tag and a BLAKE3 hash.
- Changes proceed by public PR against `spec/`. A change is normative only once tagged and the new hash is published.
- SAP/1 is published under the same AGPL-3.0 terms as the client (the spec is part of "everything on a user's machine is open source," invariant 5).

> **Research correction:** SAP/1 is published at `spnr.dev` — note that `spnr.dev` itself is currently registered (Porkbun, 2023-12-06) but serving a 502, with ownership UNVERIFIED. Confirm control of `spnr.dev` before treating the published-RFC URL as authoritative. `spnr.sh` and `spnr.co` were also assumed "owned" by the source specs but are in fact UNREGISTERED and must be registered immediately. See [adr/0005-naming-and-domains.md](adr/0005-naming-and-domains.md) and [13-research-findings.md](13-research-findings.md) §J.

---

## 2. Wire model at a glance

```
 device                                                      spnr ingest
┌──────────────────────────────┐                            ┌──────────────────────────────┐
│ Ed25519 keypair (keychain)   │                            │ POST /v1/ingest              │
│ ctr_head, chain_head (disk)  │   gzip, signed envelope    │  1. envelope sig             │
│ ~/.spnr/queue.log (10 MB)    │ ─────────────────────────► │  2. per-event sig            │
│ batch ≤ 500 events           │       HTTPS                │  3. ctr monotonicity         │
│                              │                            │  4. chain continuity (prev)  │
│                              │ ◄───────────────────────── │  5. ULID dedup               │
│   accepted_through: ctr      │     ack {accepted, head}   │  6. caps                     │
└──────────────────────────────┘                            │  7. accept → events_raw      │
                                                             └──────────────────────────────┘
 clicks: terminal OSC-8 link (in statusline, NOT spinner) → https://spnr.sh/c/{code} → 302
         click is recorded SERVER-SIDE at the redirect; the client never signs a billable click.
```

> **Research correction:** The clickable link lives in the **statusline** OSC-8 hyperlink, not the spinner. `spinnerVerbs` is plain text and is NOT clickable — do not imply "click the spinner." See [05-fraud-attestation.md](05-fraud-attestation.md) and [13-research-findings.md](13-research-findings.md) §E.

---

## 3. Device identity

### 3.1 Keypair

- At install, `spnrd` generates an **Ed25519** keypair (crate `ed25519-dalek` 2.2.0, pinned to 2.x; 3.0 is still rc as of 2026-06-12).
- The private key is sealed in the OS keychain (Secret Service on Linux, Keychain on macOS) via the `keyring` crate (4.0.1).

> **Research correction:** The source specs called the device key "non-exportable." This is FALSE for the `keyring` crate, which stores a readable secret blob. The correct claim is **"OS-keychain-protected, encrypted-at-rest."** True non-exportable / Secure-Enclave keys would require abandoned `keychain-services` or hand-rolled `security-framework` FFI plus codesigning, and are a separate, platform-specific hardening track. The SAP/1 threat model (§3.4) assumes the device key CAN be read by a sufficiently privileged local attacker. See [07-security-privacy.md](07-security-privacy.md) and [13-research-findings.md](13-research-findings.md) §F.

### 3.2 device_id

```
device_id = base32( pubkey_bytes[0..10] )      # 10 bytes of the 32-byte Ed25519 public key
```

- Encoding: RFC 4648 base32, lowercase, no padding. 10 bytes → 16 base32 characters. Example: `device_id = "n5xw6ztboi4ha2lq"`.
- `device_id` is a **truncated fingerprint for routing and logging**, not the verification key. The server stores the FULL 32-byte public key at registration and verifies signatures against the full key, never against the truncated id.
- Truncation collision risk: 80 bits is ample for a population in the 10⁵–10⁶ device range; the server MUST still reject a registration whose `device_id` prefix collides with a different full pubkey already on file (treat as anomaly, not auto-accept).

### 3.3 Login binds device → account

```
spnr login   (GitHub device flow OR email magic link, fully in-terminal)
      │
      ▼
POST /v1/devices/register
  body: { device_id, pubkey_b64, adapter, os, arch, client_version }
  auth: short-lived login token from the device-flow / magic-link exchange
      │
      ▼
server: store (device_id → pubkey, account_id, fraud_band=green, ctr_head=0, chain_head=GENESIS)
```

- The device is **pseudonymous**; the account binding exists only for crediting. The raw GitHub identity / email lives on `account`, never inside a signed event.
- One account MAY bind many devices. The device↔account graph is a fraud feature (see [05-fraud-attestation.md](05-fraud-attestation.md)), not a protocol constraint.
- Re-registration of an existing `device_id` with a *different* pubkey MUST be rejected (a device's pubkey is immutable for its lifetime; key rotation = new device).

### 3.4 Identity threat model (abridged)

| Concern | Position |
|---|---|
| Stolen device key | Attacker can sign valid events, but cannot rewrite history (chain is append-only server-side) nor exceed caps (§7.5). Detected via fraud bands, not prevented by the key store. |
| Forged `device_id` | Truncated id is not a credential; full-pubkey verification defeats forgery. |
| Multi-account sybil | Out of protocol scope; handled by server-side fraud scoring (device graph). |
| Replay of captured batch | Defeated by ULID dedup + counter monotonicity + chain continuity (§7). |

---

## 4. Canonical event schema

### 4.1 The object

Every SAP/1 event is exactly this JSON object — no more keys, no fewer:

```json
{
  "v": 1,
  "id": "01J9Z3K8Q－ULID-26CHARS",
  "ctr": 48211,
  "prev": "b3:9af3c1d2e8…",
  "t": 1781234567,
  "type": "imp",
  "session": "s:7c1f9a…",
  "creative": "cr_9k2",
  "n": 12
}
```

### 4.2 Field reference

| Field | Type | Required | Meaning |
|---|---|---|---|
| `v` | int | always | Protocol major version. Currently `1`. |
| `id` | string (ULID, 26 chars, Crockford base32) | always | Idempotency key. Time-sortable. Generated client-side at event creation. |
| `ctr` | int (u64) | always | Per-device monotonic counter. Strictly increasing, never reused, persisted to disk before the event is queued. |
| `prev` | string | always | `b3:` + hex BLAKE3 (32-byte digest) of the **previous event's canonical bytes** (§5). First event uses the genesis sentinel (§4.4). |
| `t` | int (unix seconds) | always | Daemon-stamped wall-clock at event creation. Advisory only; the server does NOT trust it for ordering (§4.5). |
| `type` | enum string | always | One of the closed set in §4.3. |
| `session` | string | always | `s:` + salted hash of the session id (§4.4). Stable within a session, unlinkable across the salt boundary. |
| `creative` | string | conditional | Creative id this event is attributed to. Required for `imp`, `click_hint`; `null`/absent for `session_start`, `session_end`, `heartbeat_summary` where no creative applies. |
| `n` | int | conditional | For `imp`: number of impressions accrued in this batch-second window. For `heartbeat_summary`: count of render heartbeats summarized. Absent for other types. |

### 4.3 `type` enum (closed)

| `type` | Carries `creative` | Carries `n` | Billable? | Notes |
|---|---|---|---|---|
| `imp` | yes | yes | **yes** | The only revenue-bearing event. `n` impressions of `creative` in this session. |
| `click_hint` | yes | no | **no** | UX only. The client's local guess that a click happened. NEVER pays out (§8). |
| `session_start` | no | no | no | Rotation point; binds `session → creative` on the server's view. |
| `session_end` | no | no | no | Closes a session; triggers a queue flush. |
| `heartbeat_summary` | no | yes | no | Periodic roll-up of render-heartbeat counts; a liveness signal for fraud scoring, not an accrual. |

> **Research correction:** `heartbeat_summary` is a *coarse liveness* signal, not a per-frame render attestation. statusLine is invoked on message boundaries with a ~300 ms debounce, not per paint, and there is no frame-level timestamp available — so SAP/1 cannot and does not claim frame-granular "render attestation." Heartbeats gate seconds inside hook-derived WAITING intervals; the honest claim is "attested + anomaly-filtered," never "viewability-grade." See [adr/0002-statusline-as-coarse-liveness-gate.md](adr/0002-statusline-as-coarse-liveness-gate.md) and [13-research-findings.md](13-research-findings.md) §A.

### 4.4 Sentinels & derived values

```
GENESIS prev      = "b3:0000000000000000000000000000000000000000000000000000000000000000"
session fingerprint = "s:" + hex( BLAKE3_keyed(device_local_salt, raw_session_id)[0..16] )
                      # device_local_salt is generated once per device, kept in keychain,
                      # never transmitted; raw_session_id NEVER leaves the machine.
prev (event k)     = "b3:" + hex( BLAKE3( canonical_bytes(event k-1) ) )   # see §5
```

- The salt makes `session` unlinkable to anyone without the device's local salt, while remaining stable for the device's own dedup/correlation. The raw session id (a path-revealing host value) is structurally never serialized — consistent with invariant 2 (never read work product).

### 4.5 Timestamp trust

> **Research correction:** Do NOT trust hook-supplied timestamps. Payload timestamp availability is inconsistent across Claude Code versions. `t` is stamped by the daemon on receipt of the hook datagram (its own monotonic + wall-clock), and even then the server treats `t` as advisory: ordering is established by `ctr` and the hash chain, NOT by `t`. The server quarantines events whose `t` is outside a ±5-minute receipt window for post-review (clock-skew handling, not ordering). See [13-research-findings.md](13-research-findings.md) §A.

### 4.6 Closed-world guarantee

- The wire structs in `spnr-proto` (see [09-repo-build-layout.md](09-repo-build-layout.md)) are the ONLY serializable types that reach the socket-to-server path. There is no open map, no `extra: HashMap`, no passthrough.
- `serde(deny_unknown_fields)` is set on the deserialize side. A batch containing an event with an unrecognized key is rejected wholesale.
- Adding a field requires editing this spec and bumping `v` (§1.2). This is the mechanical backbone of the content firewall (invariant 2): work product cannot ride along in a free-form field because there is no free-form field.

---

## 5. Canonical encoding (for signing)

Signatures are computed over **canonical bytes**, not over arbitrary pretty-printed JSON. SAP/1 uses **RFC 8785 JSON Canonicalization Scheme (JCS)**: UTF-8, keys sorted by code point, no insignificant whitespace, canonical number formatting.

```rust
// crate: serde_json_canonicalizer (a.k.a. serde_jcs)
let canonical: Vec<u8> = serde_json_canonicalizer::to_vec(&event)?;   // RFC 8785 bytes
let prev_digest        = blake3::hash(&canonical);                     // feeds the NEXT event's `prev`
let signature          = signing_key.sign(&canonical);                // Ed25519 over these exact bytes
```

> **Research correction:** The canonical-JSON serializer for signing (`serde_json_canonicalizer` / `serde_jcs`, RFC 8785) MUST be a **separate code path** from the `~/.claude/settings.json` round-trip. The settings round-trip needs `serde_json` with `preserve_order` to keep the user's key order byte-stable; the signing path needs JCS canonical ordering. Two serializers, non-overlapping — mixing them silently breaks either signatures or the user's settings file. See [13-research-findings.md](13-research-findings.md) §F and [09-repo-build-layout.md](09-repo-build-layout.md).

Canonicalization rules that matter in practice:

- **Key order:** code-point sort. The example object's logical order in §4.1 is for human reading; on the wire JCS reorders to `creative, ctr, id, n, prev, session, t, type, v`.
- **Numbers:** `ctr`, `t`, `n` are integers; JCS forbids leading zeros, `+`, exponent for these. They serialize as bare decimal.
- **Strings:** minimal escaping per JCS. `prev`/`session`/`creative` are ASCII, so no surprises.
- **Optional fields:** an absent `creative`/`n` is OMITTED, not `null`-emitted, except where §4.3 specifies an explicit `null`. Sender and receiver MUST agree on omit-vs-null per type, or the recomputed canonical bytes (and thus the signature and `prev`) diverge.

Determinism is load-bearing: the server recomputes `canonical_bytes(event)` to (a) verify the signature and (b) recompute the digest that the *next* event's `prev` must match. Any encoder nondeterminism breaks chain continuity for the whole device.

---

## 6. Signing & batch envelope

### 6.1 Per-event signature

- Each event is signed with the device's Ed25519 key over its canonical bytes (§5). The signature is carried in the envelope alongside the event, not inside the canonical object (so the canonical bytes are self-consistent and the same bytes feed `prev`).

### 6.2 Batch envelope

```json
{
  "v": 1,
  "device_id": "n5xw6ztboi4ha2lq",
  "batch_id": "01J9Z3M…ULID",
  "events": [
    { "ev": { /* canonical event, §4 */ }, "sig": "ed:base64sig" },
    { "ev": { /* … */ },                    "sig": "ed:base64sig" }
  ],
  "from_ctr": 48211,
  "to_ctr": 48460,
  "envelope_sig": "ed:base64sig"
}
```

| Constraint | Value |
|---|---|
| Max events per batch | **≤ 500** |
| Transport | `POST /v1/ingest`, body **gzip**-compressed |
| Content ordering | events MUST be in strictly ascending `ctr` order within the batch |
| `from_ctr` / `to_ctr` | first and last `ctr` in the batch (server cross-checks against its `ctr_head`) |
| `envelope_sig` | Ed25519 over the canonical bytes of the envelope **minus** `envelope_sig` itself (covers `device_id`, `batch_id`, the ordered `events`, `from_ctr`, `to_ctr`) |
| Auth header | bearer device session token (24 h, rotating); the envelope signature is the real authenticator, the token is for rate-limit/account routing |

### 6.3 Acknowledgement

```json
// 200 OK
{ "accepted_through_ctr": 48460, "chain_head": "b3:…", "rejected": [] }
// or, partial
{ "accepted_through_ctr": 48390, "chain_head": "b3:…",
  "rejected": [ { "ctr": 48391, "reason": "chain_mismatch" } ] }
```

- The client advances its `accepted_through` watermark to `accepted_through_ctr` and may prune those records from `queue.log` (§9). Events after a rejection are NOT acknowledged and MUST be retried after the client resolves the cause (typically by re-deriving `prev` from the server's reported `chain_head`).

---

## 7. Server verification pipeline

The ingest service applies these stages **in order**. The first failing stage rejects the event (and, for chain failures, every event after it in the batch, since the chain is broken). Reject reasons are returned per `ctr` in the ack (§6.3).

```
                 ┌──────────────┐
 envelope ──────►│ 0. envelope  │  verify envelope_sig vs device pubkey; reject batch on fail
                 │    signature │
                 └──────┬───────┘
                        ▼  per event, ascending ctr
 ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
 │ 1. event    │─►│ 2. counter  │─►│ 3. chain    │─►│ 4. ULID     │─►│ 5. caps     │─►│ 6. ACCEPT   │
 │    sig      │  │ monotonicity│  │ continuity  │  │ dedup       │  │ enforcement │  │ → events_raw│
 └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘
```

| # | Stage | Rule | On failure |
|---|---|---|---|
| 0 | Envelope signature | `envelope_sig` verifies against stored device pubkey; `device_id` known; single `v`. | Reject whole batch (`bad_envelope`). |
| 1 | Event signature | Recompute canonical bytes (§5); `sig` verifies against device pubkey. | Reject event (`bad_sig`). |
| 2 | Counter monotonicity | `ctr` == server's `ctr_head + 1` for the expected next; strictly increasing; never seen before. A gap (`ctr` skips ahead) is flagged, not auto-rejected (a legitimate `gap` marker, §9, explains drops). | `ctr_replay` if ≤ head; `ctr_gap` flagged. |
| 3 | Chain continuity | `prev` == server-stored digest of the device's last accepted event (`chain_head`). | Reject this and following events (`chain_mismatch`); flag fork. |
| 4 | ULID dedup | `id` not already in `events_raw` for this device (unique index). | Drop silently as duplicate (idempotent re-send is normal). |
| 5 | Caps | Per-device caps hold (≤ 600 imp/hr, ≤ 4,000 imp/day, ≤ 60 imp/wait-interval — server enforces; client enforces a superset). Over-cap impressions are clamped (`n` reduced) or shadow-discounted, never billed beyond cap (invariant 3: undercount). | Clamp/`over_cap`; account flagged. |
| 6 | Accept | Insert into `events_raw` (ClickHouse-backed via a durable buffer); advance `ctr_head`, `chain_head`. Only here does an `imp` become eligible to drive a ledger entry. | — |

Design notes:

- **Idempotency is three-layered end to end** (consistent with [06-money-settlement.md](06-money-settlement.md)): ULID unique (stage 4), `(device_id, ctr)` unique (stage 2), and downstream `ledger.ref` unique per economic event. Re-sending an already-accepted batch is a no-op, by design.
- **Gaps vs forks:** a `gap` (counter jumps forward, queue dropped oldest) is *honest loss* and is tolerated with a flag. A *fork* (two different events claim the same `prev`/`ctr`) is evidence of key compromise or tampering and routes the device to fraud review (see [05-fraud-attestation.md](05-fraud-attestation.md)).
- **Caps clamp, they don't ban.** Over-cap accrual is discarded silently to avoid teaching a fraudster where the cap is (the same shadow-discount philosophy as the fraud bands).

> **Research correction:** Because `Stop` is not guaranteed to fire exactly once per `UserPromptSubmit` (interrupts / API errors / blocking hooks can drop it), wait intervals close on `Stop` OR on a timeout. The ≤ 60-impressions-per-interval cap (stage 5) already bounds the damage of a missed close. The pipeline therefore never assumes clean hook bracketing. See [04-impression-engine.md](04-impression-engine.md) and [13-research-findings.md](13-research-findings.md) §A.

### 7.1  durable buffer before ClickHouse

`events_raw` is ClickHouse. To get exactly-once semantics under ClickHouse's at-least-once insert behavior, ingest writes accepted events to a durable buffer (Redis stream / Kafka) keyed by `(device_id, ctr)` before the ClickHouse insert; the ULID + `(device_id, ctr)` uniqueness make replays from the buffer safe. This is called out as a complexity hot-spot in [13-research-findings.md](13-research-findings.md) §G.

---

## 8. Clicks are server-attributed

This is a load-bearing protocol decision, not an implementation detail.

```
statusline OSC-8 link:  ESC]8;;https://spnr.sh/c/{short_code}?d={device_pub_short}ESC\  text  ESC]8;;ESC\
                                         │
   user clicks (terminal honors OSC 8)  ▼
   GET https://spnr.sh/c/{short_code}?d=…
                                         │  edge redirector
                                         ▼
   record (creative, device, ts, ip_class, ua)  →  302  →  advertiser URL (+ optional advertiser click-id)
```

- **Clients never self-report billable clicks.** The only client-side click artifact is `click_hint` (§4.3), which is UX-only and never accrues. Billable click truth is established entirely at the `/c/{code}` redirect, server-side.
- This removes the single most lucrative client-side fraud lever: a farm cannot mint click revenue by signing events, because signed events do not carry click money. Click fraud now requires real HTTP from plausible origins — a known, solvable adtech problem (per-device/ip-class rate limits, 10 s dedup window, bot-UA filtering, strict server-side URL allow-listing).

> **Research correction:** OSC 8 hyperlinks are real and broadly supported but operationally fragile inside Claude Code (OSC-8-stripping regressions; clicks fail in tmux/Konsole in some setups). Therefore clicks are a **best-effort BONUS signal, not core revenue**. Revenue accounting is impression-based (`imp` events); clicks are an add-on attributed via the redirect. Emit the close sequence `ESC]8;;ST`; keep URLs short (< 2083 bytes, bytes 32–126). The clickable surface is the statusline, never the plain-text spinner. See [05-fraud-attestation.md](05-fraud-attestation.md) and [13-research-findings.md](13-research-findings.md) §E.

---

## 9. Client queue persistence

### 9.1 File & format

```
path:   ~/.spnr/queue.log        (dir mode 0700; see 07-security-privacy.md for socket/file perms)
record: [ u32 length-prefix ][ canonical event bytes ][ ed25519 sig (64 bytes) ]
ordering: strictly ascending ctr (== file append order)
durability: fsync per batch append; ctr_head & chain_head persisted BEFORE the event is appended
```

### 9.2 Size bound & gap markers

- The queue is bounded at **10 MB**. On overflow the **oldest** records are dropped and a synthetic `gap` event is inserted to be honest about the loss:

```json
{ "v":1, "id":"01J…", "ctr":48999, "prev":"b3:…", "t":1781240000,
  "type":"gap", "session":null, "creative":null, "n":17 }   // n = approx events dropped
```

> Note: `gap` is a queue-integrity marker. It signs and chains like any other event so that the chain stays continuous across a drop (the server sees `gap`, accepts the forward `ctr` jump as explained loss rather than a fork, per stage 2/3). It carries no economic value. Implementations that prefer to keep the §4.3 enum minimal MAY model `gap` as a reserved subtype of `heartbeat_summary` with `creative:null`; whichever is chosen, it MUST be listed in the published spec (closed-world rule, §4.6).

### 9.3 Flush policy

| Trigger | Action |
|---|---|
| every 60 s | flush pending records as one or more ≤ 500-event batches |
| queue size threshold | flush early to bound memory and disk |
| `SessionEnd` | flush (so a session's tail is shipped promptly) |
| reconnect after offline | flush backlog oldest-first; honor server `accepted_through_ctr` watermark |

- After a successful ack (§6.3), records `≤ accepted_through_ctr` MAY be pruned from `queue.log` (compacted on next rotation). `ctr_head`/`chain_head` are the source of truth for "what to send next"; the file is the durable outbox.
- If the daemon crashes mid-flush, replay is safe: ULID dedup (stage 4) and `(device, ctr)` uniqueness (stage 2) make re-sending already-accepted events a no-op.

### 9.4 Persistence invariants

1. `ctr` is persisted (and fsync'd) **before** an event is observable to the flush loop — a counter is never reused even across a hard crash.
2. `chain_head` advances only in lockstep with appended events; a torn write is detected on restart by recomputing the last record's digest and comparing to the persisted `chain_head`.
3. The queue is append-only on the hot path; pruning happens only via whole-file rotation after an ack watermark, never via in-place edits (immutability of historical records).

---

## 10. Conformance checklist

A client is SAP/1-conformant iff:

- [ ] Generates an Ed25519 keypair at install; derives `device_id = base32(pubkey[..10])`; stores the private key in the OS keychain (encrypted-at-rest; NOT claimed non-exportable).
- [ ] Registers `device_id → account` at login; never re-registers a `device_id` under a new pubkey.
- [ ] Emits only the closed-world event schema (§4); sets `serde(deny_unknown_fields)`; bumps `v` to add any field.
- [ ] Signs over RFC 8785 canonical bytes using `serde_json_canonicalizer`, on a code path **separate** from the settings.json round-trip.
- [ ] Maintains a persisted monotonic `ctr` and a BLAKE3 hash chain (`prev`); persists both before queueing.
- [ ] Ships batches ≤ 500, gzip, to `POST /v1/ingest` with a per-event sig and an envelope sig.
- [ ] Stamps `t` at the daemon, never trusts hook-supplied timestamps, and never treats `t` as ordering truth.
- [ ] Emits `click_hint` (if at all) as UX-only; never self-reports billable clicks; relies on `/c/{code}` server attribution.
- [ ] Bounds `queue.log` at 10 MB with honest `gap` markers; flushes on 60 s / size / `SessionEnd`.

A server is SAP/1-conformant iff it runs the §7 pipeline in order, enforces three-layer idempotency, treats gaps as honest-loss-with-flag and forks as fraud signals, and clamps (never over-bills) at caps.

---

## 11. Open protocol questions

Tracked in [12-risks-open-questions.md](12-risks-open-questions.md):

1. Exact hook payload fields and timestamp availability per Claude Code version — pin against a tested version matrix; the adapter declares supported ranges. (Source: [13-research-findings.md](13-research-findings.md) §A.)
2. Whether `gap` warrants a first-class `type` or stays a reserved `heartbeat_summary` subtype (§9.2) — decide before the v1 spec freeze.
3. ULID vs UUIDv7 for `id` — `ulid` 1.2.1 is fine; `uuid` v7 (1.23.3) offers active maintenance + the same time-sortability. Pick one before freeze and never mix within a major. (Source: [13-research-findings.md](13-research-findings.md) §F.)
4. Whether to commit to V1 vs V2 framing if/when SAP events ever co-travel with x402 payment proofs (they currently do not — settlement is a separate batch rail). (Source: [06-money-settlement.md](06-money-settlement.md), [13-research-findings.md](13-research-findings.md) §D.)

*SAP/1 — Draft v0.3 — June 12, 2026 — canonical text at spnr.dev/spec (domain control unverified; see ADR-0005).*
