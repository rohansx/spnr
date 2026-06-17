# spnr browser extension

The spnr ad surface for **claude.ai** in the browser. A thin sponsored bar appears at
the bottom of the page when you submit a prompt, and impressions are reported to the
**existing** spnr backend — the same `/v1/register`, `/v1/serve`, `/v1/ingest` the
Claude Code client uses. This is a new *surface*, not a new system.

Design: [`docs/superpowers/specs/2026-06-15-chrome-extension-ad-surface-design.md`](../docs/superpowers/specs/2026-06-15-chrome-extension-ad-surface-design.md).

## How it mirrors the CLI

| CLI | Extension |
|---|---|
| `spnr-hook` / `spnr-status` (fast, no network) | **content script** — DOM + event detection only |
| `spnrd` daemon (key, network, signing) | **service worker** — identity, `/v1/serve`, signed `/v1/ingest` |
| `settings.json` injection | **Shadow-DOM bottom bar** (`position:fixed`, immune to React re-renders) |

## Privacy (content firewall preserved)

The extension detects the **act** of submitting a prompt — never the text. It reads
nothing from the composer; only the keystroke/click event triggers ad rotation. Same
no-read-work-product promise as the CLI (invariant 2).

## Build

```bash
cd extension
npm install
npm run build      # → dist/ (manifest.json, worker.js, content.js)
npm run watch      # rebuild on change
```

## Load in Chrome (unpacked)

1. `npm run build`
2. Open `chrome://extensions`, enable **Developer mode**.
3. **Load unpacked** → select `extension/dist`.
4. Open https://claude.ai and submit a prompt — the sponsored bar appears at the bottom.

Requires Chrome 137+ (WebCrypto Ed25519). To point at a local backend, set
`chrome.storage.local` key `spnr.backend` (e.g. `http://localhost:8787`).

## Test

```bash
npm test           # cross-language SAP/1 fixture tests (JS side)
```

The JS fixtures are mirrored byte-for-byte by the Rust test
`crates/spnr-proto/tests/web_compat.rs` (`cargo test -p spnr-proto`). Both sides assert
the identical canonical bytes + BLAKE3 chain digest, proving the browser's signed
events validate against the Rust `accept_event` path with **no backend changes**.

## Wire-format notes (verified against the server)

- Public key + signature are **lowercase hex** (`data_encoding::HEXLOWER` server-side),
  not base64.
- Canonical bytes are RFC 8785 JCS; every SAP/1 field is ASCII or an integer, so the
  JS encoder is byte-identical to Rust `serde_jcs`.
- The hash chain uses **BLAKE3** (no WebCrypto equivalent) — bundled via `hash-wasm`.
