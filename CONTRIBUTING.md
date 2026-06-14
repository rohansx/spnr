# Contributing to spnr

Thanks for your interest in spnr — an open, terminal-native ad network that
monetizes the wait-state ("spinner") of agentic coding CLIs.

spnr is a **v0.1 research prototype**. Contributions are welcome, but please
read the load-bearing invariants below: they are the reason spnr is safe to put
on a developer's hot path, and PRs that break them will not be merged.

## Building & Testing

The repo is polyglot: a Rust client (`crates/`), a Rust backend
(`server/spnr-server`), a TypeScript portal (`server-ts`), and a React SPA
(`web/`).

Toolchain: Rust (stable, via `cargo`), Node 18+ (for `web` and `server-ts`),
plus `jq` and `curl` for the E2E scripts.

```bash
# Rust: build everything in release mode
cargo build --release

# Rust: 14 test suites — must stay green
cargo test

# TypeScript portal: 27 tests
npm --prefix server-ts test

# React web: type-check
npm --prefix web run typecheck

# Full-stack end-to-end (spins up backend + web, runs Playwright + auth flow)
bash e2e/run.sh

# Install integration (hermetic; verifies append-not-clobber install/uninstall)
bash e2e/install.sh
```

**Every PR must keep the E2E green.** Run `bash e2e/run.sh` before you open one.

## Invariants You MUST Preserve

These are tested, documented (see `docs/` ADRs), and non-negotiable:

1. **Two-serializer / editor-safe settings merge.** `~/.claude/settings.json`
   is only ever replaced via an atomic **temp + fsync + rename**. All host keys
   must round-trip untouched. Install is **append-only** for hooks — never
   clobber or delete a user's existing hooks. Everything stays reversible via
   `spnr uninstall` (restores the pristine snapshot) and `spnr pause`.

2. **Content firewall.** The hot-path binaries (`spnr-hook`, `spnr-status`) read
   **only** `hook_event_name` and `session_id` from stdin. They must NEVER read
   the prompt, cwd, transcript, or any other field. Raw session ids never leave
   the machine — only a salted BLAKE3 fingerprint does.

3. **Always exit 0 on the hot path.** `spnr-hook` and `spnr-status` must never
   crash, block, or return non-zero. A failure is a **no-op**, never a degraded
   host. Never make the developer's agent slower or break their session.

If your change touches the protocol, signing, or the impression engine, keep the
SAP/1 guarantees intact: Ed25519-signed, BLAKE3 hash-chained, ULID + monotonic
counter, dedup on ingest.

## Code Style

- **Many small files > few large files.** High cohesion, low coupling. Keep
  modules focused (roughly 200–400 lines; extract before they sprawl).
- Prefer immutable data and explicit, comprehensive error handling.
- No hardcoded secrets, ever.

## Commits & PRs

- Use **Conventional Commits**: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`,
  `chore:`, `perf:`, `ci:`.
- Keep PRs focused. Describe what changed, why, and how you tested it.
- Confirm the relevant test suites and `bash e2e/run.sh` pass.

## Reporting Security Issues

Do **not** open a public issue for vulnerabilities. See [SECURITY.md](SECURITY.md).
