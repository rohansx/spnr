# spnr Chrome Extension — Browser Ad Surface (Design)

**Date:** 2026-06-15
**Status:** Approved design, pending spec review
**Scope:** MVP — render ads in the claude.ai web app + report impressions to the existing backend

## 1. Goal

Bring the spnr ad surface to the browser. When a user who has installed the spnr
Chrome extension uses claude.ai, a thin sponsored bar appears at the bottom of the
page, refreshed on each prompt submission, and impressions are reported back to the
**existing** spnr backend so browser sessions earn and account exactly like the
Claude Code CLI does.

The extension is a **new surface**, not a new system. It reuses the existing
device-registration, ad-serving, and signed-impression backend unchanged.

## 2. Non-goals (explicitly out of MVP)

- No contextual/keyword targeting. The content firewall (invariant 2) is preserved:
  the extension never reads what the user types — only the *event* that they submitted.
- No 5-second accrual accounting. MVP counts **one impression per qualifying turn**.
- No dashboard/admin UI changes. Web sessions surface in the existing `/admin/devices`.
- No pause/opt-out UX yet (added later, mirroring `spnr pause`).
- claude.ai only. No ChatGPT / Gemini / other hosts.

## 3. Core decisions (from brainstorming)

| Decision | Choice |
|---|---|
| Targeting | **Event-only** — detect submit, never read content. Ads rotate round-robin. |
| Placement | **Bottom status bar** — `position:fixed` bar, mirrors the CLI statusline. |
| Backend | **Reuse existing** — `/v1/register`, `/v1/serve`, `/v1/ingest` unchanged. |
| Scope | **MVP** — render + one signed impression per turn. |

## 4. Architecture — mirrors the CLI hot-path / daemon split

The CLI separates fast, network-free hooks (`spnr-hook`, `spnr-status`) from the
daemon (`spnrd`) that owns identity, network, and signing. The extension uses the
same split. This keeps the signing key out of the page context and makes the ad bar
resilient to claude.ai's React re-renders.

| CLI component | Extension equivalent | Responsibility |
|---|---|---|
| `spnr-hook` / `spnr-status` | **content script** (runs on claude.ai) | DOM injection, detect submit/stop events, impression timing. No network, no keys. |
| `spnrd` daemon | **background service worker** | Device identity, `/v1/register`, `/v1/serve` (cache pool), sign + `POST /v1/ingest`. |
| `settings.json` injection | **Shadow-DOM status bar** | `position:fixed; bottom:0` host node appended to `document.body`. |

- **Manifest V3.** `host_permissions`: claude.ai + the spnr backend origin.
  `permissions`: `storage`.
- **All network runs in the service worker** (content script talks to it via
  `chrome.runtime.sendMessage`). This avoids claude.ai's page CSP `connect-src`
  restrictions, which would block cross-origin `fetch` from the page context.

## 5. DOM injection — "smoothly writing the DOM"

The key technique is to **not anchor into Claude's DOM tree at all**:

1. Append a single host `<div>` to `document.body`.
2. Attach an **open Shadow DOM** to it; render the bar inside the shadow root.
3. Style the host `position: fixed; bottom: 0; left: 0; right: 0; z-index: <high>`.

Consequences:
- claude.ai's obfuscated, frequently-changing class names are irrelevant — we never
  query or depend on them for placement.
- React reconciliation never touches our node (it's outside React's root).
- Shadow DOM isolates our CSS both directions (no leak in, no leak out).
- A lightweight `MutationObserver` watches only for `document.body` replacement / our
  node removal and re-asserts it. It does **not** fight the framework on every render.

The bar is an `<a>` whose `href` is `<backend>/c/{short_code}`, opening in a new tab —
the same click redirector the CLI statusline uses via its OSC-8 hyperlink.

## 6. Event detection (firewall-safe)

We detect the *act*, never the *content*. No read of any input field value ever occurs.

- **Submit ("searching")**: listen for `Enter` keydown on the composer and/or click on
  the send button. The handler reads **zero** text — it only observes that a submit
  fired. On submit: rotate to the next featured ad (round-robin, same as the CLI's
  `featured_ad()`) and open an impression interval.
- **Stop (turn complete)**: detect streaming completion (send button re-enables / the
  stop button disappears) to close the interval. Browser analog of the `Stop` hook.

Selectors for the composer / send / stop controls are isolated in one small module
(`dom-anchors`) so that if claude.ai changes its markup, only that module needs
updating. Detection degrades gracefully: if we can't find the controls, the bar still
renders and rotates on a timer; we simply don't earn that turn (fail quiet, invariant 6).

## 7. Telemetry — reuse backend, zero server changes

Verified against the server source (`server/spnr-server/src/main.rs`,
`crates/spnr-proto/src/{key,canonical,chain,event}.rs`):

### Identity
- Generate an **Ed25519 keypair via WebCrypto** (`crypto.subtle.generateKey({name:"Ed25519"})`).
- Persist in `chrome.storage.local` (export the private key as JWK/pkcs8). This is the
  browser analog of the OS-keychain seal; same threat posture as the CLI's
  encrypted-at-rest (not hardware-bound) key.
- Register via existing `POST /v1/register` with the **lowercase-hex** 32-byte public
  key, `os:"web"`, client version, optional `email`. Web sessions then appear in the
  existing `/admin/devices` connected-session panel automatically.

### Serve
- `GET /v1/serve` for the creative pool (`{creatives:[{id,text,short_code,url}]}`),
  cached in the service worker, refreshed periodically.

### Impressions (MVP-simple)
- One `imp` event per qualifying turn (bar visible during a submit→stop interval),
  `n: 1`, attributed to the featured creative set at submit time.
- Build the SAP/1 `Event` exactly per `event.rs` (`v, id(ULID), ctr, prev, t, type,
  session, creative, n`), **omitting** absent optional fields (not `null`).
- Canonicalize with an **RFC 8785 JCS** encoder in JS (byte-identical to Rust
  `serde_jcs` because all keys are ASCII and all numbers are integers).
- Maintain the per-device chain client-side: `prev = "b3:" + hex(BLAKE3(canonical(prev_event)))`,
  `ctr` strictly increasing, starting from `GENESIS_PREV` / `ctr 0`.
- Sign canonical bytes with WebCrypto Ed25519; **hex-encode** the 64-byte signature.
- `POST /v1/ingest` `{device_id, events:[{e, s}]}`.

### Wire-format compatibility (confirmed)
- **Signature & pubkey are lowercase HEX, not base64** — the server decodes both with
  `data_encoding::HEXLOWER` (`main.rs:867`, `decode_pubkey:1328`). The proto doc-comment
  that says "base64" is stale; the wire is hex.
- WebCrypto Ed25519 output is a standard raw 64-byte RFC 8032 signature, which
  `ed25519-dalek::verify` accepts. ✅
- **One extra dependency:** WebCrypto has no BLAKE3. Bundle a small WASM BLAKE3 lib
  (e.g. `hash-wasm`) for the `prev` chain. This is the only non-obvious build piece.
- **Result: no backend changes required.** The fallback web-impression route considered
  during brainstorming is NOT needed.

## 8. Component breakdown (units)

| Unit | Purpose | Depends on |
|---|---|---|
| `manifest.json` | MV3 declaration, permissions, content-script + worker wiring | — |
| `content/bar.ts` | Shadow-DOM status bar render + re-assert | `dom-anchors` |
| `content/dom-anchors.ts` | All claude.ai selectors (composer/send/stop) — the only place markup-coupled | — |
| `content/events.ts` | Submit/stop detection, interval timing, messages to worker | `dom-anchors` |
| `worker/identity.ts` | WebCrypto keypair gen/persist, device_id, hex pubkey | WebCrypto, storage |
| `worker/serve.ts` | Fetch + cache `/v1/serve`, round-robin featured ad | — |
| `worker/ingest.ts` | SAP/1 event build, JCS canonical, BLAKE3 chain, sign, `/v1/ingest` | identity, jcs, blake3-wasm |
| `worker/sap1.ts` | Event struct + JCS encoder + chain helpers (mirrors `spnr-proto`) | blake3-wasm |
| `worker/index.ts` | Message router; register-on-install; orchestration | all worker units |

## 9. Error handling (invariant 6 — fail quiet, never degrade host)

- Any failure (no ads served, network down, selectors not found, signing error) →
  the extension does nothing visible-but-broken: at worst no bar / no earning. It never
  throws into claude.ai's runtime, never blocks input, never mutates their data.
- Ingest failures queue events in `chrome.storage` and retry; the chain is preserved so
  the server still validates counter/continuity on eventual delivery.
- Identity/key errors fall back to "render-only" (bar shows, no impressions counted).

## 10. Testing

- **Unit (worker):** SAP/1 JCS canonical bytes match a known Rust-produced vector;
  BLAKE3 `prev` matches `chain.rs` output for the same event; a WebCrypto-signed event
  verifies against the Rust `DeviceKey::verify` (cross-language fixture test).
- **Unit (content):** bar mounts in a shadow root; survives a simulated `body` replace;
  submit/stop detection fires on synthetic events without reading field text.
- **Integration:** load unpacked extension, point at a local `spnr-server`, complete a
  turn on claude.ai, assert one accepted `imp` in `/admin/devices` + ledger.
- **Firewall assertion:** a test that fails if any prompt/field text is ever read or sent.

## 11. Open risk register

| Risk | Mitigation |
|---|---|
| claude.ai changes composer/send markup | Isolated in `dom-anchors`; graceful timer fallback |
| WebCrypto Ed25519 availability on user's Chrome | Min Chrome version gate; feature-detect, render-only if absent |
| JCS byte mismatch | Covered by cross-language fixture test before building ingest |
| MV3 service-worker eviction mid-turn | Persist interval state in `storage`; resume on wake |
