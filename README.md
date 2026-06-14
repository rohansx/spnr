# spnr

**Get paid for your agent's wait time.** spnr is an open, terminal-native ad network that monetizes the wait-state — the *spinner* — of agentic coding CLIs like Claude Code and Codex.

While your agent is working, the spinner shows sponsored, rotating, **clickable** creatives plus a live earnings status line. You earn a share of ad revenue for that attested wait-time — without ever exposing your prompt, your code, or your terminal session to the network.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](#license)
[![Rust](https://img.shields.io/badge/rust-stable-orange.svg)](https://www.rust-lang.org/)
[![status: v0.1 prototype](https://img.shields.io/badge/status-v0.1%20prototype-yellow.svg)](#project-status)

> **Heads up:** spnr is a **v0.1 research prototype**. The full client → attested impression → verified ledger → live dashboard loop works and is tested. Real-money settlement is **not** implemented — see [Project status](#project-status) before you read any further into the economics.

---

## Features

- **Monetize the agent spinner wait-state** — idle agent time becomes attested, payable ad inventory.
- **Multiple rotating, clickable ads** — the spinner cycles a served pool of creatives; the status line is a live, clickable [OSC-8](https://gist.github.com/egmontkob/eb114294efbcd5adb1944c9f3cb5feda) hyperlink whose target rotates (~1 Hz) through each ad's redirector URL.
- **One-command install that is append-only and reversible** — `spnr install` snapshots your pristine config, **appends** its hooks without clobbering any existing hook, and symlinks its binaries. `spnr uninstall` restores the byte-identical pristine config.
- **Content firewall / privacy by construction** — the hot-path binaries read *only* `hook_event_name` and `session_id` off stdin. Never the prompt, cwd, or transcript. Raw session ids never leave the machine (salted BLAKE3 fingerprint).
- **Signed + hash-chained impressions** — every impression is an Ed25519-signed, BLAKE3 hash-chained, monotonic-counter event (the SAP/1 protocol). The backend verifies the signature, chain continuity, counter, and dedup before crediting anything.
- **Double-entry USD-micros ledger** — advertiser → house → developer (50/50). The ledger always sums to zero, and that invariant is tested.
- **Email/password auth** — argon2id password hashing + SQLite-backed sessions, with a `RequireAuth` route guard in the web app.
- **Live dashboard + advertiser portal** — a React SPA with a developer dashboard (live impressions, balance, attestation rate) and an advertiser portal backed by a TypeScript campaign/auction API.
- **Never degrade the host** — the hot-path binaries *always* exit 0. A failure is a no-op, never a crash; injection fails *stock* (no ad) rather than breaking your editor.

---

## Quickstart

### Fastest — one-liner (connects to the hosted backend)

```bash
curl -fsSL https://get.spnr.sh | bash
```

(Also works directly from source: `curl -fsSL https://raw.githubusercontent.com/rohansx/spnr/main/install/get.sh | bash`.)

Requires `git` + a Rust toolchain (`cargo`). This clones the repo, builds the client
binaries, wires spnr into Claude Code (**append-only and reversible** — your existing
hooks/settings are untouched), and starts the daemon against the hosted backend. Run a
Claude Code turn and the spinner shows rotating sponsored ads with a clickable earnings
status line. Reverse anytime with `spnr uninstall`. Point at your own backend with
`SPNR_SERVER=https://your-backend curl -fsSL … | bash`.

### Or run the whole stack locally

Requires a Rust toolchain (`cargo`), Node 18+, and `jq` + `curl` for the test scripts.

```bash
# 1. Build everything (client crates + the reference backend)
cargo build --release

# 2. Run the reference backend (axum + SQLite) on http://127.0.0.1:8787
./target/release/spnr-server

# 3. Wire spnr into Claude Code (append-only; snapshots your settings first)
spnr install --server http://127.0.0.1:8787

# 4. Start the daemon: registers a device key, fetches the creative pool,
#    and atomically injects the rotating spinner + clickable status line
SPNR_SERVER=http://127.0.0.1:8787 spnrd &

# 5. Run a Claude Code turn. The spinner now shows sponsored verbs and the
#    status line shows your live, clickable earnings ticker.

# 6. Inspect what happened
spnr status     # queued events + whether the spinner is injected or stock
spnr audit      # dump the RAW outbound queue, so you can verify what leaves your machine

# 7. Reverse it completely — restores your byte-identical pristine config
spnr uninstall
```

`spnr` resolves the binaries built in step 1 (or the symlinks `install` drops into `~/.local/bin`). The backend persists to `~/.spnr-server.db` by default (override with `SPNR_DB`); the daemon keeps its state under `~/.spnr` (override with `SPNR_HOME`).

### The `spnr` CLI

| Command | What it does |
|---|---|
| `spnr install [--server URL]` | Snapshot pristine settings, append spnr hooks, symlink binaries. |
| `spnr uninstall` | Restore the pristine snapshot; remove hooks, symlinks, and state. |
| `spnr status` | One-line local status: queued events + spinner injected vs. stock. |
| `spnr pause` / `spnr resume` | Restore stock config and stop accruing / resume accruing. |
| `spnr audit` | Print the raw outbound queue for privacy self-verification. |
| `spnr login` / `spnr redeem` | **Stubs** — print the canonical URL; the backend lands in a later slice. |

---

## Architecture

```
┌─────────────────────────────────────────── your machine ───────────────────────────────────────────┐
│                                                                                                       │
│   Claude Code (host CLI)                                                                               │
│        │  hooks: UserPromptSubmit / Stop / SessionEnd        statusLine: spnr-status (~1 Hz)           │
│        ▼                                                              ▼                                │
│   ┌──────────────┐   ┌───────────────┐                       ┌───────────────┐                        │
│   │  spnr-hook   │   │ spnr-settings │  atomic temp+fsync     │  spnr-status  │  prints clickable      │
│   │ (hot path,   │   │ editor-safe   │  +rename merge of       │ (hot path,    │  OSC-8 status line     │
│   │  exit 0,     │   │ settings.json │  ~/.claude/settings.json│  exit 0)      │  (link rotates ~1 Hz)  │
│   │  content-FW) │   └───────────────┘                        └───────────────┘                        │
│   └──────┬───────┘            ▲                                       │                                │
│          │ Unix datagram      │ inject spinnerVerbs + statusLine      │ heartbeat                       │
│          ▼                    │ (spnr-adapters: ClaudeCodeCli)        ▼                                │
│   ┌──────────────────────────────────────────────────────────────────────────┐                       │
│   │  spnrd (daemon)                                                            │                       │
│   │   impression engine · append-only signed queue · Unix-socket API          │                       │
│   │   SAP/1: Ed25519 sign + BLAKE3 hash-chain + ULID + monotonic counter       │                       │
│   └───────────────────────────────────┬──────────────────────────────────────┘                       │
└───────────────────────────────────────│───────────────────────────────────────────────────────────────┘
                                         │  /v1/register · /v1/serve · /v1/ingest (signed events)
                                         ▼
                        ┌────────────────────────────────────────┐
                        │  spnr-server (Rust: axum + SQLite)      │
                        │   verify sig + chain + dedup            │
                        │   double-entry ledger (adv→house→dev)   │──► /c/{code} click redirector
                        │   email/password auth · /api/stats      │
                        └───────────────────┬────────────────────┘
                                            │  /api/stats · /v1/me · auth
                                            ▼
                        ┌────────────────────────────────────────┐
                        │  web (Vite + React 18 + TS SPA)         │
                        │   landing · developer dashboard ·       │
                        │   advertiser portal · login (guarded)   │
                        └────────────────────────────────────────┘
                        server-ts (Express): campaigns · creative content-lint · auction
```

### How it works — the impression loop

1. **Open the wait window.** When you submit a prompt, Claude Code fires the `UserPromptSubmit` hook. `spnr-hook` forwards *only* the event name and session id to `spnrd` over a Unix socket; the daemon opens a "waiting" interval for that session.
2. **Heartbeat the spinner.** While the agent works, Claude Code runs the injected `statusLine` command (`spnr-status`) roughly once a second. Each tick is a heartbeat that gates *countable* seconds — wall-clock alone never counts.
3. **Close the window.** The `Stop` hook closes the interval. The daemon converts attested seconds into impressions: **5 attested seconds = 1 impression** (undercount, never overcount).
4. **Sign + chain.** The daemon builds a SAP/1 `Imp` event, signs it with the device Ed25519 key, links it into the BLAKE3 hash chain (with a monotonic counter and a ULID), and appends the signed envelope to its local queue.
5. **Flush + verify.** The daemon batches and POSTs signed events to `/v1/ingest`. The backend re-verifies the **signature**, **chain continuity**, **counter monotonicity**, and **ULID dedup** — it trusts nothing the client claims.
6. **Accrue.** A verified impression accrues the double-entry ledger (advertiser → developer 50% + advertiser → house 50%), and the React dashboard reflects the real, attested earnings live.

---

## Privacy & Security

These invariants are load-bearing, real, and tested:

- **Content firewall.** The hot-path binaries (`spnr-hook`, `spnr-status`) parse only `hook_event_name` and `session_id` from stdin and discard everything else — the prompt, cwd, and transcript are never read or transmitted. The end-to-end test feeds a `"do not leak me"` prompt and asserts it never appears in the outbound queue.
- **Editor-safe atomic merge.** `~/.claude/settings.json` is only ever replaced by an atomic **temp + fsync + rename**. Every host key round-trips; install is **append-only** for hooks (verified: zero deletions against a realistic config with pre-existing RTK / gitnexus / session-end hooks).
- **Append-only, reversible install.** `install` snapshots the pristine config *before* any change. `uninstall` restores it byte-identically (foreign hooks intact, spnr gone); `pause` restores stock config immediately without depending on the daemon.
- **`spnr audit`.** Prints the exact raw outbound queue, so you can verify what actually leaves your machine against the closed collected-list claim.
- **Raw session ids never leave the machine.** What goes on the wire is a salted, truncated BLAKE3 fingerprint (`s:…`), stable per session and irreversible.
- **Operator connection metadata (not work product).** The content firewall above is unchanged — your prompts, cwd, transcript, and code are never collected. Separately, the daemon's one-time `/v1/register` call records standard device/connection metadata for the admin console: source IP, OS, arch, hostname, spnr version, and — *only if you set `SPNR_EMAIL`* — your email (omitted otherwise). This never travels on the hot path and never includes your work product.
- **Exit-0 invariant.** The hot-path binaries always exit 0 and never panic on untrusted input. A write or network failure is a silent no-op — spnr can fail, but it can never degrade or crash your editor.

---

## Repository layout

| Path | Stack | Contents |
|---|---|---|
| `crates/` | Rust | 8 client crates (see below). |
| `server/spnr-server/` | Rust (axum + SQLite) | Reference backend: register, serve, ingest+verify, redeem, click redirector, auth, ledger, dashboard. |
| `server-ts/` | TypeScript (Express) | v2 portal API: campaigns, creative content-lint, auction. JSON-file store. |
| `web/` | Vite + React 18 + TS | SPA: landing, developer dashboard, advertiser portal, guarded login. |
| `e2e/` | Bash + Playwright | `run.sh` (full stack), `install.sh` (install integration), `playwright/*.cjs`. |
| `docs/` | Markdown | Planning corpus (`00`–`15`) + ADRs `0001`–`0008`. |
| `install/`, `ci/`, `spec/` | — | Install helpers, CI config, protocol spec. |

The 8 Rust client crates in `crates/`:

| Crate | Role |
|---|---|
| `spnr-proto` | SAP/1 protocol: Ed25519 signing, BLAKE3 hash-chaining, ULID ids, monotonic-counter events, canonicalization. |
| `spnr-settings` | Editor-safe atomic merge of `~/.claude/settings.json` (temp + fsync + rename); preserves all host keys. |
| `spnr-hook` | Hot-path hook binary — content-firewalled, always exits 0, < 1 MB. |
| `spnr-status` | Hot-path status-line binary — prints the clickable OSC-8 ticker, always exits 0. |
| `spnr-adapters` | Per-host adapters (`ClaudeCodeCli`) that inject the spinner/status line. |
| `spnrd` | The daemon: impression engine, append-only signed queue, Unix-socket API, network loop. |
| `spnr-cli` | The `spnr` user CLI. |
| `spnr-meta` | Shared metadata. |

---

## Development & Testing

All of the following are real and currently green:

```bash
# Rust: build the whole workspace (client crates + backend)
cargo build --release

# Rust tests (14 suites green): proto, settings, daemon engine, backend verify/ledger/auth
cargo test

# TypeScript portal tests (27)
npm --prefix server-ts test

# React app typecheck
npm --prefix web run typecheck

# Full-stack E2E: real binaries + real Unix socket + real HTTP, then Playwright
#   verifies the live React dashboard, advertiser portal, and email/password auth
#   flow — including a backend-restart persistence check against SQLite.
bash e2e/run.sh

# Install integration: drives the REAL `spnr` binary against a throwaway $HOME and
#   proves install is append-not-clobber and uninstall restores a byte-identical config.
bash e2e/install.sh
```

`e2e/run.sh` proves the entire loop end-to-end: backend serves a creative → daemon injects the spinner and registers its device key → a simulated Claude Code session (real `spnr-hook` / `spnr-status` over the Unix socket) accrues attested wait-time → the daemon signs + chains + flushes SAP/1 events → the backend verifies and accrues a balanced ledger → the live dashboard reflects real earnings. It also asserts the content firewall held (no prompt/cwd in the queue) and that attested data survives a backend restart.

---

## Project status

**v0.1 research prototype.** Honest breakdown:

### Working & tested

| Area | Status |
|---|---|
| Client → attested impression → verified ledger → live dashboard | ✅ end-to-end |
| Multiple **clickable, rotating** ads (spinner pool + OSC-8 status line) | ✅ |
| One-command install / uninstall (append-not-clobber, reversible) | ✅ |
| Content firewall (no prompt/cwd/transcript leaves the machine) | ✅ |
| SAP/1 signed + BLAKE3 hash-chained impressions, verified server-side | ✅ |
| Double-entry USD-micros ledger (always sums to zero) | ✅ |
| Email/password auth (argon2id + SQLite sessions) | ✅ |
| Advertiser portal + auction API (TypeScript) | ✅ |
| SQLite persistence across backend restart | ✅ |
| Full E2E + Playwright (auth, dashboard, advertiser) + hermetic install test | ✅ |

### Stubbed / not yet built

| Area | Reality |
|---|---|
| **Real money settlement (x402 / USDC)** | ❌ Not implemented. `redeem` is a **balanced ledger entry only** — there is **no real payout**. |
| `spnr login` | ❌ Stub — prints the canonical URL; the auth-binding backend lands in a later slice. |
| Daemon persistence / lifecycle | ❌ Runs as a plain background process; **no systemd unit** yet. |
| Hosted production | ❌ The backend runs **locally on `:8787`**; there is no hosted prod deployment. |
| Fraud-scoring model | ❌ Verification (sig/chain/dedup) is real; an ML fraud-scoring model is not. |
| Auction → serve binding | ❌ The auction API and the served creative pool are not yet wired together. |

> **Do not** treat spnr as production-ready, and **do not** read its ledger as real money. It is a working proof of the architecture and the privacy/attestation invariants — not a payments product.

---

## Contributing

Issues and pull requests are welcome. Start with `docs/14-go-no-go.md` and `docs/01-architecture.md` for the design rationale, and the ADRs (`docs/adr/0001`–`0008`) for the load-bearing decisions. Please run `cargo test`, `npm --prefix server-ts test`, and `bash e2e/run.sh` before opening a PR.

## License

MIT © [rohansx](https://github.com/rohansx) — see the repository at [github.com/rohansx/spnr](https://github.com/rohansx/spnr).
