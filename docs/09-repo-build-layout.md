# 09 · Repo & Build Layout

> The cargo workspace, per-crate responsibilities, verified dependency pins, the hot-path size budget and how it's met, the two-serializer rule, build toolchain, reproducibility, licensing, and namespace reservations.
> Status: Draft v0.3 · June 12, 2026

Cross-references: [02-technical-spec.md](02-technical-spec.md) · [03-protocol-SAP1.md](03-protocol-SAP1.md) · [06-money-settlement.md](06-money-settlement.md) · [07-security-privacy.md](07-security-privacy.md) · [08-testing-strategy.md](08-testing-strategy.md) · [10-implementation-plan.md](10-implementation-plan.md) · [12-risks-open-questions.md](12-risks-open-questions.md) · [13-research-findings.md](13-research-findings.md) · ADRs: [0001](adr/0001-payout-default-gift-cards-not-api-credits.md) · [0002](adr/0002-statusline-as-coarse-liveness-gate.md) · [0003](adr/0003-x402-batch-settlement-not-per-impression.md) · [0004](adr/0004-platform-risk-adapter-abstraction.md) · [0005](adr/0005-naming-and-domains.md) · [0007](adr/0007-language-split-rust-client-ts-backend.md)

---

## 0. Implementation languages — [ADR-0007](adr/0007-language-split-rust-client-ts-backend.md)

Two languages, split by change-profile and criticality (the cargo workspace below is the Rust half):

- **Rust** — the client (daemon `spnrd`, hot-path `spnr-hook`/`spnr-status`, CLI `spnr`, shared `spnr-proto`) **and** the correctness/latency-critical server pieces: the ingest **verifier** + **ledger** + **redirector** (`spnr-server`). The verifier **reuses `spnr-proto`** for Ed25519/BLAKE3 — **ONE crypto codepath shared client↔server**, never a second implementation.
- **TypeScript** — the web frontend (`web/`, a **React 18 + TS SPA** on Vite — [ADR-0008](adr/0008-frontend-react-ts-spa.md)) and the v0.2 advertiser portal + auction + payments/fulfillment API (`server-ts/`). These **call the Rust verifier rather than reimplementing it**; they own only the CRUD/portal/payments surface, which iterates fast.

Rationale: fast iteration on the portal/payments surface, while latency-critical and crypto-load-bearing code stays Rust with one verification codepath. v0.1 ships on the Rust thin-verifier; the TypeScript tier is additive in v0.2 and does **not** rewrite any v0.1 Rust component. Full rationale and alternatives in [ADR-0007](adr/0007-language-split-rust-client-ts-backend.md).

---

## 1. Workspace tree

One cargo workspace. Client crates and the SAP/1 protocol are **AGPL-3.0**; operational glue (deployment, billing reconciliation, internal dashboards) stays in a private repo and is **not** part of this workspace.

```
spnr/                          # cargo workspace root, AGPL-3.0 (client + protocol)
├─ Cargo.toml                  # [workspace] members, shared [workspace.dependencies], release profiles
├─ Cargo.lock                  # committed; all builds use --locked
├─ rust-toolchain.toml         # pinned channel = stable x.y.z (exact, not "stable")
├─ deny.toml                   # cargo-deny: license + advisory + dep-source gate
├─ crates/
│  ├─ spnrd/                   # long-running user daemon (heavy deps isolated HERE)
│  ├─ spnr-cli/                # `spnr` user CLI (login/status/redeem/pause/audit/uninstall)
│  ├─ spnr-hook/               # hook forwarder — HOT PATH, dependency-lean, <1 MB stripped
│  ├─ spnr-status/             # statusline renderer — HOT PATH, dependency-lean, <1 MB stripped
│  ├─ spnr-proto/              # SAP/1 wire types, signing, canonical encoding (shared client/server)
│  ├─ spnr-meta/               # restricted JSONL timing reader — content-firewalled (see 07)
│  └─ adapters/                # HostAdapter impls: claude-code-cli, codex-cli, vscode (thin)
│     ├─ Cargo.toml            # (adapters can be one crate w/ features, or a sub-folder of crates)
│     ├─ claude-code-cli/
│     ├─ codex-cli/
│     └─ vscode/
├─ server/                     # backend services (axum) — own sub-workspace or members
│  ├─ ingest/                  # verify, dedup, hash-chain check, accept to events_raw
│  ├─ auction/                 # serving decisions, open ascending queue
│  ├─ ledger/                  # double-entry, Postgres (pgledger port — see 06)
│  ├─ settle/                  # x402/USDC (Base) + gift-card/credit redemption
│  ├─ portal-api/              # advertiser self-serve
│  └─ redirector/             # /c/{code} edge — latency-critical, p99 < 50 ms
├─ spec/                       # SAP/1 protocol RFC, published at spnr.dev (markdown + test vectors)
├─ install/                    # get.spnr.sh installer (≤100 lines, version-pinned, readable)
├─ ci/                         # reproducible-build, editor-safety, egress-canary, size-check gates
└─ packaging/                  # systemd user unit + launchd plist templates (see §7)
```

> **Research correction:** the source tech-spec (§13) sketched this tree without verified dependency pins or a concrete size-budget mechanism, and labelled the hot-path target as a bare aspiration. This doc supplies the verified pins (§3), the two-serializer rule (§4), and the *how* of the size budget (§5). See [13-research-findings.md](13-research-findings.md) §F.

---

## 2. Per-crate responsibility table

| Crate | Responsibility | Network I/O | JSON deserialize | Heavy deps allowed | Size class |
|---|---|---|---|---|---|
| `spnrd` | ad cache + rotation, settings merge state machine, impression engine, event signing/queue, self-update, socket API | yes (batched HTTPS) | yes (own structs only) | **yes — isolated here** | background, <10 MB |
| `spnr-cli` | thin client of the daemon socket: `login/status/redeem/pause/audit/uninstall` | no (via daemon) | minimal | moderate | interactive, <10 MB |
| `spnr-hook` | hook forwarder: skim stdin for 3 keys, datagram to socket, exit | **none** | **none** (hand extractor, no serde for stdin) | **no** | **HOT, <1 MB stripped** |
| `spnr-status` | print cached statusline from tmpfs, ping daemon (≤1/s) | **none** | **none** | **no** | **HOT, <1 MB stripped** |
| `spnr-proto` | SAP/1 wire structs, Ed25519 signing, BLAKE3 chaining, canonical JSON (RFC 8785) | no | yes (closed-world structs) | no (lean by design) | lib |
| `spnr-meta` | restricted JSONL timing reader; reconciliation cross-check only | no | restricted parser only | no | lib (firewalled) |
| `adapters/*` | `HostAdapter` impls (inject/restore/event_source) — platform-risk firewall | no | no | no | lib |
| `server/*` | ingest/auction/ledger/settle/portal/redirector | yes | yes | yes | service |

Latency budgets (from [02-technical-spec.md](02-technical-spec.md)): `spnr-hook` exit ≤ 50 ms hard (10 ms typical), `spnr-status` exit ≤ 10 ms hard. These budgets are *editor-safety* invariants (#1), not soft goals.

> **Research correction:** the original spec assumed hook fire-and-forget is essentially free. Research measured hook invocation overhead at **~200 ms in some setups** — that's *host process spawn + plumbing*, outside our binary, but it means the hook path must be **benchmarked end-to-end before default-on**; if it adds perceptible latency, make it opt-in. The `<50 ms` budget is for *our* binary only. See [13-research-findings.md](13-research-findings.md) §A and [08-testing-strategy.md](08-testing-strategy.md).

---

## 3. Verified dependency table

All versions verified against crates.io on **2026-06-12**. Pin in `[workspace.dependencies]`; build with `--locked`.

### Client (hot-path crates take **none** of the heavy rows)

| Crate | Version (pin) | Used by | Purpose | Notes / corrections |
|---|---|---|---|---|
| `keyring` | `4.0.1` | `spnrd`, `spnr-cli` | OS keychain (Secret Service / macOS Keychain) | **NOT non-exportable.** Stores readable secret blobs. Claim is "OS-keychain-protected, encrypted-at-rest," not "non-exportable." See callout below + [07-security-privacy.md](07-security-privacy.md). |
| `ed25519-dalek` | `2.2.0` (pin **2.x**) | `spnr-proto` | device-key signing | 3.0 still rc; do **not** float to 3. |
| `blake3` | `1.8.5` | `spnr-proto`, `spnr-hook` | per-device hash chain (`prev`), build-hash | lean enough for the hot path. |
| `ulid` | `1.2.1` | `spnr-proto` | event idempotency key | **Or** `uuid` v7 `1.23.3` — more active maintenance + time-sortability. Pick one; see §3.1. |
| `uuid` (alt) | `1.23.3` (v7 feature) | `spnr-proto` | time-sortable id | alternative to `ulid`. |
| `serde_json` | `1.0.150` | `spnrd`, `spnr-cli`, `spnr-meta` | settings round-trip (with `preserve_order`) | **serializer #1** — see §4. |
| `serde_json_canonicalizer` / `serde_jcs` | latest | `spnr-proto` | RFC 8785 canonical JSON for signing | **serializer #2** — separate code path, see §4. |
| `notify` | `8.2.0` | `spnrd` | inotify/FSEvents watcher on settings.json | **`spnrd` only** — heavy, never in hot path. |
| `tokio` | `1.52.3` | `spnrd`, `server/*` | async runtime | **`spnrd` and server only.** Hot-path crates are sync `std`. |
| `self_update` | `0.44.0` | `spnrd` | binary self-update | **verifies zipsign (ed25519), NOT minisign** — see §6. |
| `minisign-verify` | `0.2.5` | `spnrd` | verify minisign release sig | manual path if not using zipsign — see §6. |
| `tempfile` | `3.27.0` | `spnrd` | atomic temp-file for settings write | temp file + `rename(2)`. |

### Backend (server/* — heavy is fine)

| Crate | Version | Service | Purpose |
|---|---|---|---|
| `axum` | `0.8.x` | all services | HTTP framework |
| `sqlx` | `0.8.x` | `ledger`, `portal-api` | compile-time-checked queries; `SQLX_OFFLINE` in CI; prefer over diesel |
| `redis-rs` / `fred` | latest | `auction`, `redirector` | auction head, creative cache, rate limits, click dedup |
| `clickhouse` (official) | latest | `ingest`, `fraud` | event analytics; use its `Inserter`, batch 10k–50k rows |
| `x402-axum` | `1.5.6` | `settle`, `portal-api` | x402 server (402 + PaymentRequirements) |
| `x402-reqwest` | `1.5.6` | `settle` | x402 client |
| `alloy-rs` | latest | `settle` | Base/USDC contract calls (**not** ethers-rs) |

> **Research correction:** depend on the **component** crates `x402-axum` / `x402-reqwest` at **1.5.6**, NOT the stale `x402-rs` umbrella crate (0.12.5). Pin to a protocol version (V1 vs V2). See [06-money-settlement.md](06-money-settlement.md) and [13-research-findings.md](13-research-findings.md) §D.

> **Research correction:** the `keyring` crate does **not** provide non-exportable / Secure-Enclave keys — it stores readable secret blobs. True hardware-bound keys need the abandoned `keychain-services` or hand-rolled `security-framework` FFI + codesigning, and are a separate platform-specific hardening track (tracked in [12-risks-open-questions.md](12-risks-open-questions.md)). The source spec's "device key non-exportable where platform allows" is downgraded to "OS-keychain-protected, encrypted-at-rest." Threat model in [07-security-privacy.md](07-security-privacy.md).

### 3.1 ULID vs UUIDv7 decision (open)

Both give time-sortable, idempotency-friendly ids. `ulid` 1.2.1 is the spec's choice and matches the pgledger ULID-keyed ledger ([06-money-settlement.md](06-money-settlement.md)). `uuid` v7 (1.23.3) has more active maintenance. **Decision rule:** keep `ulid` for SAP/1 wire compatibility and pgledger key alignment unless maintenance staleness bites; if it does, UUIDv7 is the drop-in. Tracked in [12-risks-open-questions.md](12-risks-open-questions.md).

---

## 4. Two serializers, non-overlapping

Two JSON paths exist and **must never share a serializer**. Mixing them silently breaks either signatures or user settings.

| Path | Crate / API | Property required | Why |
|---|---|---|---|
| **Settings round-trip** (`~/.claude/settings.json`) | `serde_json` with `preserve_order` feature | preserve key order + unknown keys byte-for-byte | We re-merge only spnr-owned keys; everything else must round-trip unchanged (invariant #1, see [02-technical-spec.md](02-technical-spec.md) §2.3). |
| **Event signing** (SAP/1) | `serde_json_canonicalizer` / `serde_jcs` (RFC 8785) | deterministic canonical bytes (sorted keys, no whitespace) | The Ed25519 signature is over canonical bytes; any nondeterminism makes signatures unverifiable. |

```
settings.json  ── serde_json (preserve_order) ──► merge spnr keys ──► temp+fsync+rename
SAP/1 event    ── serde_json_canonicalizer ─────► canonical bytes ──► Ed25519 sign
                                  ▲
                  NEVER cross these wires
```

> **Research correction:** canonical JSON for signing (RFC 8785) must use `serde_json_canonicalizer`/`serde_jcs`, and it must be a **separate code path** from the settings round-trip (which needs `serde_json` `preserve_order`). Two serializers, non-overlapping. A lint/grep gate in `ci/` fails the build if the canonical crate is imported by the settings module or vice-versa. See [13-research-findings.md](13-research-findings.md) §F.

`spnr-proto` owns the canonical path. The settings module (in `adapters/claude-code-cli` + `spnrd`) owns the `preserve_order` path. They are in different crates so the dependency boundary is mechanically enforceable.

---

## 5. Hot-path size budget: `<1 MB stripped` and HOW

Target: `spnr-hook` and `spnr-status` each **< 1 MB stripped**. The source spec called this out as ambitious; research confirms it is **achievable only by construction**, not by accident.

How it is met:

| Lever | Mechanism | Where |
|---|---|---|
| **Lean deps** | hot-path crates depend on `std` (`UnixDatagram`) + `blake3` + a hand-rolled stdin skimmer. **No** `tokio`, `serde_json`, `keyring`, `notify`, `self_update`, `reqwest`. | `crates/spnr-hook`, `crates/spnr-status` `Cargo.toml` |
| **`panic = "abort"`** | drops unwinding tables/landing pads | `[profile.release-hot]` |
| **`opt-level = "z"`** | optimize for size | `[profile.release-hot]` |
| **`strip = true` + `lto = "thin"` + `codegen-units = 1` + `panic="abort"`** | dead-code elim, strip symbols | `[profile.release-hot]` |
| **Isolate heavy deps in `spnrd`** | all heavy crates live only in the daemon and CLI, never the hot path | crate boundary (§2) |
| **CI size-check gate** | build hot binaries, `ls -l` stripped artifact, **fail if > 1 MB** | `ci/size-check` |

```toml
# Cargo.toml (workspace root) — dedicated profile for hot-path binaries
[profile.release-hot]
inherits     = "release"
opt-level    = "z"
lto          = "thin"
codegen-units = 1
panic        = "abort"
strip        = true
```

```bash
# ci/size-check (sketch) — blocks release on regression
for bin in spnr-hook spnr-status; do
  cargo build --profile release-hot -p "$bin" --locked
  sz=$(stat -c%s "target/release-hot/$bin")
  [ "$sz" -le 1048576 ] || { echo "FAIL: $bin = $sz bytes (> 1 MiB)"; exit 1; }
done
```

> **Research correction:** `<1 MB stripped` is "ambitious but achievable" *only* with the discipline above — lean deps, `panic=abort`, `opt-level=z`, and strict isolation of `keyring`/`notify`/`tokio`/`self_update` in `spnrd`. The CI size-check is the enforcement mechanism, not a nicety. See [13-research-findings.md](13-research-findings.md) §F.

Note: `panic = "abort"` is compatible with invariant #1 — a hot-path binary panicking should *abort fast and exit non-fatally to the host* (the host treats a missing hook output as a no-op; see [02-technical-spec.md](02-technical-spec.md)). The daemon (`spnrd`) uses the normal `release` profile (unwinding) so it can recover and restore stock config.

---

## 6. Self-update signing: zipsign vs minisign

The spec's threat-model row paired `self_update` with minisign. That pairing does **not** work out of the box.

> **Research correction:** `self_update` `0.44.0` verifies **zipsign (ed25519)**, NOT minisign. Two valid paths — pick one and document it; don't assume the pairing works. See [13-research-findings.md](13-research-findings.md) §F and [07-security-privacy.md](07-security-privacy.md).

| Option | Flow | Trade-off |
|---|---|---|
| **A — native zipsign** | sign releases with zipsign (ed25519); `self_update` verifies natively | least code; commits to zipsign tooling in the release pipeline |
| **B — manual minisign** | disable `self_update`'s signature feature; download artifact, verify with `minisign-verify` (0.2.5) ourselves, then atomically replace the binary | keeps published-hashes + minisign story consistent with `install/`; slightly more code in `spnrd` |

**Recommendation:** Option B for v0.1 — it keeps one signing story (minisign) across `install/get.spnr.sh`, published release hashes, and self-update, so the user-verifiable chain is uniform. Reconsider zipsign if pipeline ergonomics dominate. Decision tracked in [12-risks-open-questions.md](12-risks-open-questions.md).

The updater is user-level only and **never auto-elevates privileges** (from [02-technical-spec.md](02-technical-spec.md) §9). Channels: `stable` + `canary`, staged rollout percentages server-side.

---

## 7. Service management: systemd / launchd (no turnkey crate)

> **Research correction:** there is **no turnkey Rust crate** for systemd user-unit / launchd-agent lifecycle. Write the unit/plist file and shell out to `systemctl --user` / `launchctl`. Prefer `zbus`/`sd-notify` on Linux for readiness/notify integration. See [13-research-findings.md](13-research-findings.md) §F.

Approach: the installer (and `spnr` CLI) write a templated unit/plist from `packaging/`, then shell out to the platform service manager.

| Platform | Unit file written to | Activation commands |
|---|---|---|
| **Linux** | `~/.config/systemd/user/spnrd.service` | `systemctl --user daemon-reload`, `systemctl --user enable --now spnrd`, stop via `--now` disable |
| **macOS** | `~/Library/LaunchAgents/sh.spnr.spnrd.plist` | `launchctl bootstrap gui/$UID <plist>`, `launchctl kickstart -k gui/$UID/sh.spnr.spnrd`, teardown `launchctl bootout gui/$UID/sh.spnr.spnrd` |

- Linux readiness: `spnrd` uses `sd-notify` (`READY=1`) and `zbus` for any DBus interaction rather than polling.
- macOS has no `sd-notify` equivalent — readiness is inferred from the socket appearing at `~/.spnr/spnrd.sock`.
- Headless / no-keychain boxes: daemon runs **paused** (per [02-technical-spec.md](02-technical-spec.md) §11); service still installs so logs/status work.
- Uninstall reverses both: `bootout`/`disable --now`, remove unit/plist, then settings RESTORE from snapshot.

Windows native is deferred; WSL is treated as Linux ([12-risks-open-questions.md](12-risks-open-questions.md)).

---

## 8. Build toolchain & cross-compilation

| Target | Tooling | Output |
|---|---|---|
| Linux x86_64 / aarch64 | `cargo-zigbuild` → **musl static** | fully static, no glibc dep |
| macOS arm64 + x86_64 | build both, `lipo` → **universal2** | single fat binary |
| all | `--locked`, pinned `rust-toolchain.toml`, `[profile.release-hot]` for hot bins | deterministic |

> **Research correction:** the musl-static + universal2 targets are reached with `cargo-zigbuild` (musl, cross-compile without a full cross toolchain) and `lipo` (macOS universal2) — these are the concrete mechanisms behind the spec's "musl static / universal2" line. See [13-research-findings.md](13-research-findings.md) §F.

```bash
# Linux static (both arches), single host via zig
cargo zigbuild --profile release-hot --target x86_64-unknown-linux-musl  --locked
cargo zigbuild --profile release-hot --target aarch64-unknown-linux-musl --locked

# macOS universal2 (run on macOS)
cargo build --profile release-hot --target aarch64-apple-darwin --locked
cargo build --profile release-hot --target x86_64-apple-darwin  --locked
lipo -create -output spnr-hook-universal \
  target/aarch64-apple-darwin/release-hot/spnr-hook \
  target/x86_64-apple-darwin/release-hot/spnr-hook
```

Whole-binary size targets (from [02-technical-spec.md](02-technical-spec.md)): `spnrd`/`spnr` < 10 MB; hot bins < 1 MB stripped (§5).

---

## 9. Reproducible builds & published hashes

Invariant #5: everything on a user's machine is open source **and reproducible**.

- Pinned `rust-toolchain.toml` (exact channel, not `stable`), committed `Cargo.lock`, all builds `--locked`.
- `SOURCE_DATE_EPOCH` set; `--remap-path-prefix` to strip absolute build paths; deterministic `codegen-units`.
- Publish **BLAKE3** hashes (already the chain hash in `spnr-proto`) for every released artifact, plus a **minisign** signature over the hash manifest.
- The `install/get.spnr.sh` script (≤ 100 lines, version-pinned) verifies the downloaded binary against the published BLAKE3 hash **and** minisign signature before install.
- `ci/` runs a **build-twice-and-diff** job: two independent clean builds must produce byte-identical hot-path artifacts, or release is blocked.

| Surface | Hash published | Sig | Verified by |
|---|---|---|---|
| release binaries | BLAKE3 | minisign | installer + `spnrd` self-update (§6) |
| SAP/1 test vectors | BLAKE3 | — | `spnr-proto` tests |

See [08-testing-strategy.md](08-testing-strategy.md) for the reproducible-build CI gate and the egress-canary / editor-safety gates that share the `ci/` directory.

---

## 10. Licensing

| Component | License | Repo |
|---|---|---|
| `crates/*` (all client crates) | **AGPL-3.0** | public workspace |
| `spec/` (SAP/1 protocol RFC) | **AGPL-3.0** (or permissive for the wire spec — see note) | public |
| `server/*` reference services (ingest/auction/ledger/settle/portal/redirector) | **AGPL-3.0** | public (self-hostable) |
| Ops glue (deploy, billing reconciliation, internal dashboards, treasury automation) | **private / proprietary** | separate private repo |

AGPL-3.0 on client + protocol + reference backend matches invariant #5 (auditable, self-hostable) and the product positioning of an open protocol with a reference network ([00-product-overview.md](00-product-overview.md)). Ops glue stays private — it's the operational moat, not user-facing code. Note: the *wire spec* may additionally carry a permissive grant so third parties can implement compatible clients without AGPL obligations on their own implementations; resolve before the SAP/1 RFC publishes ([12-risks-open-questions.md](12-risks-open-questions.md)).

---

## 11. Namespaces & domains

Verified 2026-06-12. **Reserve now.** Full rationale in [adr/0005-naming-and-domains.md](adr/0005-naming-and-domains.md).

| Registry | Name | Status | Action |
|---|---|---|---|
| crates.io | `spnr` | **FREE** | reserve `0.0.1` placeholder immediately (no squat protection) |
| npm | `spnr` | **TAKEN** (dormant frontend lib, v1.8.1) | publish under scope **`@spnr/*`**; `@spnr` scope appears claimable |
| npm | `@spnrapp` | confusable crypto scope ("Spinner.Cash") | **avoid** — do not register near it |
| GitHub | `spnr` | **TAKEN — dormant USER** "SPNR" (id 13784566, since 2015, soil-science, last active 2016) | **NOT an org name.** Use alt org handle: `spnr-sh` / `spnrhq` / `getspnr`, or try to acquire the dormant user name |

> **Research correction:** the source spec implied GitHub `spnr` was free (the earlier check hit `/orgs/spnr` → 404). It is a dormant **user** account, not an available org. Pick an alternative org handle. See [13-research-findings.md](13-research-findings.md) §J and [adr/0005-naming-and-domains.md](adr/0005-naming-and-domains.md).

| Domain | Status (whois/RDAP, 2026-06-12) | Action |
|---|---|---|
| `spnr.sh` | **UNREGISTERED / available** | register immediately |
| `spnr.co` | **UNREGISTERED / available** | register immediately |
| `spnr.dev` | **registered** (Porkbun, 2023-12-06, serving 502), ownership **unverified** | confirm whether founder's or third party's |
| `spnr.com` | long-held (2006) third-party parked domain, expires 2026-09-17 | not cheaply acquirable; keep anti-phishing posture (single canonical login/redemption host; CLI opens exact URLs) |

> **Research correction:** the source spec stated `spnr.sh` / `spnr.co` were "owned." Refuted — both are **unregistered and available; register both immediately.** `spnr.dev` is registered with ownership unverified. See [13-research-findings.md](13-research-findings.md) §J.

---

## 12. Workspace conventions (summary)

- Many small focused crates over few large ones; crate boundaries are the **mechanism** for the size budget (§5), the content firewall ([07-security-privacy.md](07-security-privacy.md)), and the two-serializer rule (§4) — not just organization.
- Shared pins live in `[workspace.dependencies]`; crates reference them with `workspace = true`.
- `cargo-deny` (`deny.toml`) gates licenses (AGPL-compatible only in client), RUSTSEC advisories, and dependency sources.
- Every release passes, in `ci/`: editor-safety suite, egress-canary, reproducible build-twice-diff, hot-path size-check, and the two-serializer import lint — all blocking. See [08-testing-strategy.md](08-testing-strategy.md).
